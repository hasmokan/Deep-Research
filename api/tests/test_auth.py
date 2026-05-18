"""Supabase auth helpers."""

from unittest import TestCase

from fastapi import HTTPException


class SupabaseAuthTests(TestCase):
    def test_get_current_user_requires_bearer_token(self):
        from services.auth import get_current_user

        with self.assertRaises(HTTPException) as raised:
            get_current_user(authorization=None)

        self.assertEqual(raised.exception.status_code, 401)

    def test_get_current_user_returns_verified_user_id(self):
        from services import auth

        auth.supabase_auth_client = FakeSupabaseClient("user-123")
        self.addCleanup(lambda: setattr(auth, "supabase_auth_client", None))

        user = auth.get_current_user(authorization="Bearer valid-token")

        self.assertEqual(user.user_id, "user-123")
        self.assertEqual(auth.supabase_auth_client.auth.seen_token, "valid-token")

    def test_get_current_user_rejects_invalid_token(self):
        from services import auth

        auth.supabase_auth_client = FakeSupabaseClient(None)
        self.addCleanup(lambda: setattr(auth, "supabase_auth_client", None))

        with self.assertRaises(HTTPException) as raised:
            auth.get_current_user(authorization="Bearer invalid-token")

        self.assertEqual(raised.exception.status_code, 401)


class FakeSupabaseClient:
    def __init__(self, user_id):
        self.auth = FakeAuth(user_id)


class FakeAuth:
    def __init__(self, user_id):
        self.user_id = user_id
        self.seen_token = None

    def get_user(self, jwt):
        self.seen_token = jwt
        return FakeUserResponse(self.user_id)


class FakeUserResponse:
    def __init__(self, user_id):
        self.user = FakeUser(user_id) if user_id else None


class FakeUser:
    def __init__(self, user_id):
        self.id = user_id
