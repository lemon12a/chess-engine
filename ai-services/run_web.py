import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chess
import torch

from model import ChessNet, load_checkpoint, find_latest_checkpoint
from mcts import mcts_search

SCRIPT_DIR = Path(__file__).resolve().parent

# Model dùng cho web (pretrain v2). Thứ tự ưu tiên:
#   1) biến môi trường CHESS_AI_CHECKPOINT (đường dẫn tới file .pt)
#   2) ../results/web_model/pretrained_lichess.pt (đặt file v2 vào đây)
#   3) checkpoint mới nhất do find_latest_checkpoint() tìm được (hành vi cũ)
WEB_MODEL_PATH = SCRIPT_DIR.parent / "results" / "web_model" / "pretrained_lichess.pt"

# Số lượt MCTS mặc định (đo trên Colab: 200 lượt cho kết quả tốt hơn 50 và 100 lượt khi đấu Greedy).
# Có thể đổi bằng biến môi trường CHESS_AI_SIMULATIONS; client vẫn gửi "simulations" để ghi đè được.
DEFAULT_SIMULATIONS = int(os.environ.get("CHESS_AI_SIMULATIONS", "200"))
MAX_SIMULATIONS = 800  # chặn client gửi số quá lớn làm treo server

app = FastAPI(title="Chess AI Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = ChessNet().to(device)

checkpoint_path = os.environ.get("CHESS_AI_CHECKPOINT")
if not checkpoint_path and WEB_MODEL_PATH.exists():
    checkpoint_path = str(WEB_MODEL_PATH)
if not checkpoint_path:
    checkpoint_path = find_latest_checkpoint()

if checkpoint_path:
    load_checkpoint(checkpoint_path, model, device=device)
    print(f"Đã tải checkpoint: {checkpoint_path}")
else:
    print("CẢNH BÁO: không tìm thấy checkpoint — model chạy với trọng số ngẫu nhiên.")

model.eval()


class MoveRequest(BaseModel):
    fen: str
    simulations: int = DEFAULT_SIMULATIONS


class MoveResponse(BaseModel):
    move: str


@app.post("/ai-move", response_model=MoveResponse)
def ai_move(req: MoveRequest) -> MoveResponse:
    try:
        board = chess.Board(req.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="FEN không hợp lệ.")

    if board.is_game_over():
        raise HTTPException(status_code=400, detail="Ván đấu đã kết thúc, không còn nước đi.")

    simulations = max(1, min(req.simulations, MAX_SIMULATIONS))
    best_move = mcts_search(board, model, num_simulations=simulations)
    return MoveResponse(move=best_move.uci())


@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": str(device),
        "checkpoint": checkpoint_path or "none (random weights)",
        "default_simulations": DEFAULT_SIMULATIONS,
    }