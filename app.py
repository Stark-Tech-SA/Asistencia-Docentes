from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "attendance.db"
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"
UPLOADS_DIR = BASE_DIR / "uploads"


def db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    UPLOADS_DIR.mkdir(exist_ok=True)
    with db_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS branding (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                institution_name TEXT NOT NULL,
                subtitle TEXT NOT NULL,
                primary_color TEXT NOT NULL,
                accent_color TEXT NOT NULL,
                logo_path TEXT
            );
            CREATE TABLE IF NOT EXISTS teachers (
                id TEXT PRIMARY KEY,
                full_name TEXT NOT NULL,
                document_code TEXT NOT NULL,
                area TEXT,
                unique_code TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS attendance (
                id TEXT PRIMARY KEY,
                teacher_id TEXT NOT NULL,
                attendance_type TEXT NOT NULL,
                happened_at TEXT NOT NULL,
                FOREIGN KEY (teacher_id) REFERENCES teachers (id)
            );
            """
        )
        exists = conn.execute("SELECT 1 FROM branding WHERE id=1").fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO branding VALUES (1,?,?,?,?,?)",
                (
                    "Mi Institución",
                    "Control de asistencia de docentes",
                    "#184e77",
                    "#52b788",
                    None,
                ),
            )


def unique_code() -> str:
    while True:
        code = f"DOC-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:6].upper()}"
        with db_conn() as conn:
            row = conn.execute("SELECT 1 FROM teachers WHERE unique_code=?", (code,)).fetchone()
        if not row:
            return code


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = urlparse(self.path)
        if route.path == "/":
            return self.serve_file(TEMPLATES_DIR / "index.html", "text/html; charset=utf-8")
        if route.path.startswith("/static/"):
            return self.serve_file(STATIC_DIR / route.path.replace("/static/", ""), self.mime(route.path))
        if route.path.startswith("/uploads/"):
            return self.serve_file(UPLOADS_DIR / route.path.replace("/uploads/", ""), self.mime(route.path))
        if route.path == "/api/bootstrap":
            return self.api_bootstrap()
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self):
        route = urlparse(self.path)
        if route.path == "/api/teachers":
            return self.api_create_teacher()
        if route.path == "/api/attendance":
            return self.api_create_attendance()
        if route.path == "/api/branding":
            return self.api_update_branding()
        self.send_error(HTTPStatus.NOT_FOUND)

    def api_bootstrap(self):
        with db_conn() as conn:
            b = conn.execute("SELECT * FROM branding WHERE id=1").fetchone()
            teachers = conn.execute("SELECT * FROM teachers ORDER BY created_at DESC").fetchall()
            attendance = conn.execute(
                """
                SELECT a.id, a.teacher_id, a.attendance_type, a.happened_at,
                       t.full_name, t.unique_code
                FROM attendance a JOIN teachers t ON t.id=a.teacher_id
                ORDER BY a.happened_at DESC
                """
            ).fetchall()
        self.send_json(
            {
                "branding": {
                    "institution_name": b["institution_name"],
                    "subtitle": b["subtitle"],
                    "primary_color": b["primary_color"],
                    "accent_color": b["accent_color"],
                    "logo_url": b["logo_path"] or "",
                },
                "teachers": [dict(row) for row in teachers],
                "attendance": [
                    {
                        "id": r["id"],
                        "teacher_id": r["teacher_id"],
                        "teacher_name": r["full_name"],
                        "unique_code": r["unique_code"],
                        "attendance_type": r["attendance_type"],
                        "happened_at": r["happened_at"],
                    }
                    for r in attendance
                ],
            }
        )

    def api_create_teacher(self):
        payload = self.read_json()
        full_name = payload.get("full_name", "").strip()
        document_code = payload.get("document_code", "").strip()
        area = payload.get("area", "").strip()
        if not full_name or not document_code:
            return self.send_json({"error": "Nombre y documento son requeridos"}, 400)

        teacher_id = str(uuid4())
        created_at = datetime.now().isoformat(timespec="seconds")
        code = unique_code()

        with db_conn() as conn:
            conn.execute(
                "INSERT INTO teachers VALUES (?,?,?,?,?,?)",
                (teacher_id, full_name, document_code, area, code, created_at),
            )

        self.send_json(
            {
                "id": teacher_id,
                "full_name": full_name,
                "document_code": document_code,
                "area": area,
                "unique_code": code,
                "created_at": created_at,
            }
        )

    def api_create_attendance(self):
        payload = self.read_json()
        code = payload.get("unique_code", "").strip()
        mode = payload.get("attendance_type", "AUTO")
        with db_conn() as conn:
            teacher = conn.execute("SELECT * FROM teachers WHERE unique_code=?", (code,)).fetchone()
            if not teacher:
                return self.send_json({"error": "Docente no encontrado"}, 404)

            if mode == "AUTO":
                last = conn.execute(
                    "SELECT attendance_type FROM attendance WHERE teacher_id=? ORDER BY happened_at DESC LIMIT 1",
                    (teacher["id"],),
                ).fetchone()
                mode = "ENTRADA" if not last or last["attendance_type"] == "SALIDA" else "SALIDA"

            if mode not in {"ENTRADA", "SALIDA"}:
                return self.send_json({"error": "Tipo inválido"}, 400)

            aid = str(uuid4())
            happened_at = datetime.now().isoformat(timespec="seconds")
            conn.execute("INSERT INTO attendance VALUES (?,?,?,?)", (aid, teacher["id"], mode, happened_at))

        self.send_json(
            {
                "id": aid,
                "teacher_id": teacher["id"],
                "teacher_name": teacher["full_name"],
                "unique_code": teacher["unique_code"],
                "attendance_type": mode,
                "happened_at": happened_at,
            }
        )

    def api_update_branding(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8")
        data = parse_qs(body)
        institution_name = data.get("institution_name", ["Mi Institución"])[0].strip() or "Mi Institución"
        subtitle = data.get("subtitle", ["Control de asistencia de docentes"])[0].strip() or "Control de asistencia de docentes"
        primary_color = data.get("primary_color", ["#184e77"])[0]
        accent_color = data.get("accent_color", ["#52b788"])[0]
        with db_conn() as conn:
            logo_path = data.get("logo_url", [""])[0].strip() or None
            conn.execute(
                "UPDATE branding SET institution_name=?,subtitle=?,primary_color=?,accent_color=?,logo_path=? WHERE id=1",
                (institution_name, subtitle, primary_color, accent_color, logo_path),
            )
        self.send_json({"ok": True})

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def serve_file(self, file_path: Path, content_type: str):
        if not file_path.exists() or not file_path.is_file():
            return self.send_error(HTTPStatus.NOT_FOUND)
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        self.wfile.write(file_path.read_bytes())

    def send_json(self, payload: dict, status: int = 200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def mime(path: str) -> str:
        if path.endswith(".css"):
            return "text/css; charset=utf-8"
        if path.endswith(".js"):
            return "application/javascript; charset=utf-8"
        if path.endswith(".png"):
            return "image/png"
        if path.endswith(".jpg") or path.endswith(".jpeg"):
            return "image/jpeg"
        return "application/octet-stream"


def run() -> None:
    init_db()
    port = int(os.environ.get("PORT", "5000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Servidor activo en http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
