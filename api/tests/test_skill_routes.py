"""Skill management API routes."""

import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from fastapi.testclient import TestClient

from main import app
from services.auth import AuthenticatedUser, get_current_user


class SkillRouteTests(TestCase):
    def test_skill_routes_require_authentication(self):
        client = TestClient(app)

        response = client.get("/api/skills")

        self.assertEqual(response.status_code, 401)

    def test_skill_routes_manage_local_skill_files(self):
        client = TestClient(app)

        with TemporaryDirectory() as tmp:
            previous = os.environ.get("AGENT_SKILLS_DIR")
            os.environ["AGENT_SKILLS_DIR"] = tmp
            app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(user_id="user-1")

            try:
                create_response = client.put(
                    "/api/skills/custom-research",
                    json={
                        "description": "Custom research behavior.",
                        "content": "Prefer primary sources.",
                        "allowed_tools": ["web_search"],
                    },
                )
                file_exists_after_create = (Path(tmp) / "custom-research" / "SKILL.md").exists()
                list_response = client.get("/api/skills")
                disable_response = client.patch(
                    "/api/skills/custom-research/enabled",
                    json={"enabled": False},
                )
                disabled_list_response = client.get("/api/skills")
                delete_response = client.delete("/api/skills/custom-research")
                final_list_response = client.get("/api/skills")
            finally:
                app.dependency_overrides.clear()
                if previous is None:
                    os.environ.pop("AGENT_SKILLS_DIR", None)
                else:
                    os.environ["AGENT_SKILLS_DIR"] = previous

        self.assertEqual(create_response.status_code, 200)
        self.assertEqual(create_response.json()["name"], "custom-research")
        self.assertTrue(file_exists_after_create)
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual([skill["name"] for skill in list_response.json()], ["custom-research"])
        self.assertEqual(disable_response.status_code, 200)
        self.assertFalse(disable_response.json()["enabled"])
        self.assertFalse(disabled_list_response.json()[0]["enabled"])
        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(final_list_response.json(), [])
