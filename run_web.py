from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chess
import torch

from model import ChessNet, load_checkpoint, find_latest_checkpoint
from mcts import mcts_search

app = FastAPI(title="Chess AI Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = ChessNet().to(device)

checkpoint_path = find_latest_checkpoint()
if checkpoint_path:
    load_checkpoint(checkpoint_path, model, device=device)
    print(f"Đã tải checkpoint: {checkpoint_path}")
else:
    print("CẢNH BÁO: không tìm thấy checkpoint — model chạy với trọng số ngẫu nhiên.")

model.eval()


class MoveRequest(BaseModel):
    fen: str
    simulations: int = 40


class MoveResponse(BaseModel):
    move: str


@app.post("/ai-move", response_model=MoveResponse)
def ai_move(req: MoveRequest) -> MoveResponse:
    board = chess.Board(req.fen)

    if board.is_game_over():
        raise HTTPException(status_code=400, detail="Ván đấu đã kết thúc, không còn nước đi.")

    best_move = mcts_search(board, model, num_simulations=req.simulations)
    return MoveResponse(move=best_move.uci())


@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": str(device),
        "checkpoint": checkpoint_path or "none (random weights)",
    }