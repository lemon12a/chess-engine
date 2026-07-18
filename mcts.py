# mcts.py
import math
import chess
import torch
import torch.nn.functional as F
from board import board_to_tensor, move_to_index

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
        return self.q_value + u

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

def mcts_search(board, model, num_simulations=50):
    root = MCTSNode(board)
    
    for _ in range(num_simulations):
        node = root
        # Selection
        while len(node.children) > 0 and not node.board.is_game_over():
            _, node = node.select_child()
            
        if node.board.is_game_over():
            result = node.board.result()
            value = 1.0 if result == "1-0" else (-1.0 if result == "0-1" else 0.0)
            node.backpropagate(value)
            continue
            
        # Evaluation & Expansion
        state_tensor = board_to_tensor(node.board)
        with torch.no_grad():
            policy_logits, value_tensor = model(state_tensor)
        
        action_probs = F.softmax(policy_logits, dim=1).flatten().numpy()
        value = value_tensor.item()
        
        node.expand(action_probs)
        node.backpropagate(value)
        
    return max(root.children.items(), key=lambda item: item[1].visit_count)[0]