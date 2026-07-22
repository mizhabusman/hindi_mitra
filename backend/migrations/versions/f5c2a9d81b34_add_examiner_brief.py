"""add conversations.examiner_brief

Private examiner setup for an interview. Stored on the conversation and folded
into the system prompt; never a chat message, so it stays out of the transcript,
scoring, and the assessment.

Revision ID: f5c2a9d81b34
Revises: e3b1d9f4a2c6
Create Date: 2026-07-16
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f5c2a9d81b34"
down_revision: Union[str, None] = "e3b1d9f4a2c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("conversations", schema=None) as batch_op:
        batch_op.add_column(sa.Column("examiner_brief", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("conversations", schema=None) as batch_op:
        batch_op.drop_column("examiner_brief")
