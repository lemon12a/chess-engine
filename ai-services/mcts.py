# mcts.py
import math
import numpy as np
import chess
import torch
import torch.nn.functional as F
from board import board_to_tensor, move_to_index, get_legal_action_mask, ACTION_SPACE_SIZE

class MCTSNode:
    def __init__(self, board, parent=None, prior_p=0.0):
        self.board = board.copy()
        self.parent = parent
        self.prior_p = prior_p
        self.children = {} # {chess.Move: MCTSNode}
        self.visit_count = 0
        self.value_sum = 0.0

    @property
    def q_value(self):
        return self.value_sum / self.visit_count if self.visit_count > 0 else 0.0

    def get_puct(self, c_puct=1.4):
        if not self.parent:
            return 0.0
        u = c_puct * self.prior_p * math.sqrt(self.parent.visit_count) / (1 + self.visit_count)
        # BUG NGHIÊM TRỌNG ĐÃ SỬA: self.q_value được tính từ backpropagate() theo góc nhìn
        # của người SẮP ĐI TẠI self (node con) - tức là góc nhìn của ĐỐI THỦ so với người
        # đang chọn nước tại node cha (select_child() gọi hàm này trên từng node con để
        # cha quyết định nên đi nước nào). Nếu dùng thẳng self.q_value (không đổi dấu),
        # node cha sẽ ưu tiên chọn nước dẫn đến thế cờ TỐT CHO ĐỐI THỦ - tức chọn NHẦM
        # nước tệ nhất thay vì tốt nhất. Đã kiểm chứng bằng test thực tế: với bug này,
        # MCTS không chọn nước ăn Hậu đối phương đang bị hở dù có 200 simulation.
        # Phải phủ định (-self.q_value) để quy về đúng góc nhìn của node cha.
        return -self.q_value + u

    def select_child(self):
        return max(self.children.items(), key=lambda item: item[1].get_puct())

    def expand(self, action_probs):
        for move in self.board.legal_moves:
            if move not in self.children:
                idx = move_to_index(move)
                prob = action_probs[idx]
                next_board = self.board.copy()
                next_board.push(move)
                self.children[move] = MCTSNode(next_board, parent=self, prior_p=prob)

    def backpropagate(self, value):
        self.visit_count += 1
        self.value_sum += value
        if self.parent:
            self.parent.backpropagate(-value)


def mcts_search(board, model, num_simulations=50, temperature=0.0, return_policy=False):
    """
    MCTS kiểu AlphaZero: dùng model để định hướng (policy prior trong PUCT) và đánh giá
    thế trận (value), thay vì rollout ngẫu nhiên đến hết ván như MCTS cổ điển.

    temperature:
        - 0.0 (mặc định): chọn nước đi có visit_count cao nhất (chơi "nghiêm túc"/greedy).
          Giữ nguyên hành vi gốc, main.py gọi hàm này không cần sửa gì thêm.
        - > 0.0: lấy mẫu (sample) nước đi theo phân phối visit_count^(1/temperature), tăng
          đa dạng khi thu thập dữ liệu. Dùng ở các nước đi đầu ván self-play (xem train.py).

    return_policy:
        - False (mặc định): chỉ trả về nước đi được chọn - giữ nguyên hành vi/API gốc.
        - True: trả về thêm policy_target (phân phối theo visit_count, kích thước
          ACTION_SPACE_SIZE) để làm nhãn huấn luyện cho policy head.
    """
    root = MCTSNode(board)
    
    for _ in range(num_simulations):
        node = root
        # Selection: đi theo PUCT đến khi gặp node lá (chưa expand) hoặc ván đấu kết thúc
        while len(node.children) > 0 and not node.board.is_game_over():
            _, node = node.select_child()
            
        if node.board.is_game_over():
            result = node.board.result()  # "1-0" / "0-1" / "1/2-1/2" - LUÔN theo góc nhìn Trắng
            value = 1.0 if result == "1-0" else (-1.0 if result == "0-1" else 0.0)
            # BUG ĐÃ SỬA: value ở trên đang ở góc nhìn Trắng, nhưng cả backpropagate() lẫn
            # nhánh đánh giá bằng model bên dưới đều quy ước value theo góc nhìn của NGƯỜI
            # SẮP ĐI tại node đó (node.board.turn) - đây là quy ước bắt buộc để việc đổi dấu
            # value khi đi lên node cha trong backpropagate() có ý nghĩa đúng. Nếu không quy
            # đổi, mỗi khi simulation "chạm" phải 1 thế cờ đã kết thúc trong lúc search
            # (không phải root), Q-value của các node cha/ông sẽ bị tính sai dấu.
            value = value if node.board.turn == chess.WHITE else -value
            node.backpropagate(value)
            continue
            
        # Evaluation & Expansion
        # BUG ĐÃ SỬA: board_to_tensor() luôn tạo tensor trên CPU, nhưng khi train.py chạy
        # trên GPU thì model đã được .to(device="cuda"). Đưa tensor vào model khác device
        # với trọng số của model sẽ báo lỗi "Expected all tensors to be on the same device".
        # FIX: lấy device thực tế của model (next(model.parameters()).device) rồi chuyển
        # state_tensor sang đúng device đó trước khi đưa vào model. Trên máy không có GPU,
        # device sẽ là "cpu" như cũ, không ảnh hưởng gì - đoạn code này an toàn cho cả 2
        # trường hợp.
        device = next(model.parameters()).device
        state_tensor = board_to_tensor(node.board).to(device)
        with torch.no_grad():
            policy_logits, value_tensor = model(state_tensor)
        
        # BUG ĐÃ SỬA: bản gốc tính softmax trên TOÀN BỘ không gian hành động, bao gồm cả
        # nước đi bất hợp lệ ở vị trí hiện tại -> tổng xác suất của riêng các nước đi HỢP
        # LỆ nhỏ hơn 1 (bị "rò rỉ" sang hành động không thể xảy ra) -> prior_p dùng trong
        # PUCT bị lệch thấp hơn thực tế, làm giảm tác dụng dẫn dắt của policy network.
        # FIX: gán logit của nước đi bất hợp lệ = -vô cực (xấp xỉ) TRƯỚC khi softmax, để
        # softmax tự dồn hết xác suất vào các nước đi hợp lệ (tổng đúng bằng 1).
        # (Cùng lý do device ở trên: legal_mask tạo bằng numpy -> CPU, phải .to(device)
        # trước khi so sánh/gán vào masked_logits đang nằm trên GPU; và phải .cpu() lại
        # TRƯỚC .numpy() vì numpy không đọc trực tiếp được tensor trên GPU.)
        legal_mask = get_legal_action_mask(node.board)
        legal_mask_tensor = torch.from_numpy(legal_mask).to(device)
        masked_logits = policy_logits.flatten().clone()
        masked_logits[legal_mask_tensor == 0] = -1e9
        action_probs = F.softmax(masked_logits, dim=0).cpu().numpy()
        
        value = value_tensor.item()
        
        node.expand(action_probs)
        node.backpropagate(value)
    
    moves = list(root.children.keys())
    visit_counts = np.array([child.visit_count for child in root.children.values()], dtype=np.float64)
    
    if temperature <= 1e-3:
        # Greedy: chọn nước có visit_count cao nhất (tương đương hành vi gốc)
        chosen_move = moves[int(np.argmax(visit_counts))]
    else:
        # Sampling theo phân phối visit_count^(1/temperature) - dùng khi thu thập dữ liệu
        scaled = visit_counts ** (1.0 / temperature)
        probs = scaled / scaled.sum()
        chosen_idx = np.random.choice(len(moves), p=probs)
        chosen_move = moves[chosen_idx]
    
    if return_policy:
        policy_target = np.zeros(ACTION_SPACE_SIZE, dtype=np.float32)
        total_visits = visit_counts.sum()
        for move, count in zip(moves, visit_counts):
            policy_target[move_to_index(move)] = count / total_visits
        return chosen_move, policy_target
    
    return chosen_move