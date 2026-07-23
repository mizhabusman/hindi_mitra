"""remove teams, managers, and audit_log (unused planned features)

Drops the never-used audit_log table, the teams table, and the users.team_id
link. The manager role and team/manager feature code were removed alongside
this; role is a plain VARCHAR (no DB constraint), so no enum change is needed.

Revision ID: e3b1d9f4a2c6
Revises: c4a7e1f9d2b8
Create Date: 2026-07-16
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e3b1d9f4a2c6"
down_revision: Union[str, None] = "c4a7e1f9d2b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    # Audit log — never read or written.
    op.drop_table("audit_log")
    # SQL Server refuses to drop a column while a foreign key references it, and
    # the FK has an auto-generated name — so look it up by column and drop it
    # first. Other dialects (SQLite/etc.) resolve this inside the batch below.
    if bind.dialect.name == "mssql":
        op.execute(
            "DECLARE @fk sysname; "
            "SELECT @fk = fk.name FROM sys.foreign_keys fk "
            "JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id "
            "WHERE fk.parent_object_id = OBJECT_ID('users') "
            "AND COL_NAME(fkc.parent_object_id, fkc.parent_column_id) = 'team_id'; "
            "IF @fk IS NOT NULL EXEC('ALTER TABLE users DROP CONSTRAINT ' + @fk);"
        )
    # Remove the users -> teams link, then the teams table itself.
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("team_id")
    op.drop_table("teams")


def downgrade() -> None:
    op.create_table(
        "teams",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("team_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_users_team_id_teams", "teams", ["team_id"], ["id"], ondelete="SET NULL"
        )
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("target", sa.String(length=200), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
