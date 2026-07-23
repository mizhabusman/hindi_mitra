"""unique employee_id on users (+ backfill existing rows)

Revision ID: c4a7e1f9d2b8
Revises: b6f6128fad41
Create Date: 2026-07-15 09:40:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4a7e1f9d2b8"
down_revision: Union[str, None] = "b6f6128fad41"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Keep in lockstep with app.services.user_service.format_employee_id — migrations
# are historical snapshots, so the format is duplicated here on purpose.
_PREFIX = "EMP"


def _employee_id(seq: int) -> str:
    return f"{_PREFIX}{seq:04d}"


def upgrade() -> None:
    # 1) Add the column nullable so existing rows can be updated in place.
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("employee_id", sa.String(length=20), nullable=True))

    # 2) Backfill existing users with a unique id derived from the PK. Admins are
    #    system/operator accounts, not employees, so they're left NULL.
    bind = op.get_bind()
    ids = [
        row[0]
        for row in bind.execute(
            sa.text("SELECT id FROM users WHERE role <> 'admin' ORDER BY id")
        ).fetchall()
    ]
    for uid in ids:
        bind.execute(
            sa.text("UPDATE users SET employee_id = :eid WHERE id = :id"),
            {"eid": _employee_id(uid), "id": uid},
        )

    # 3) Enforce uniqueness. Filtered on SQL Server so the admin's NULL
    #    employee_id doesn't collide — SQL Server permits only ONE NULL in a
    #    unique index, whereas Postgres/SQLite allow many (there the filter is a
    #    harmless no-op).
    op.create_index(
        op.f("ix_users_employee_id"), "users", ["employee_id"], unique=True,
        mssql_where=sa.text("employee_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_users_employee_id"), table_name="users")
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("employee_id")
