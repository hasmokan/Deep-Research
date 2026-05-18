"""Supabase JWT authentication helpers."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Header, HTTPException
from supabase import Client, create_client

from core.config import get_settings


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: str


supabase_auth_client: Client | None = None


def get_supabase_auth_client() -> Client:
    global supabase_auth_client

    if supabase_auth_client is None:
        settings = get_settings()
        supabase_auth_client = create_client(settings.supabase_url, settings.supabase_key)

    return supabase_auth_client


def get_current_user(authorization: str | None = Header(default=None)) -> AuthenticatedUser:
    token = _bearer_token(authorization)
    client = get_supabase_auth_client()

    try:
        response = client.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc

    supabase_user = getattr(response, "user", None)
    user_id = getattr(supabase_user, "id", None)

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authentication token")

    return AuthenticatedUser(user_id=str(user_id))


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authentication token")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Missing authentication token")

    return token.strip()
