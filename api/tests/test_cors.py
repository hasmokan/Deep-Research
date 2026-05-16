"""CORS behavior for local frontend development."""

from unittest import TestCase

from fastapi.testclient import TestClient

from main import app


class CorsTests(TestCase):
    def test_allows_localhost_frontend_origin(self):
        client = TestClient(app)

        response = client.options(
            "/api/research/execute",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["access-control-allow-origin"],
            "http://localhost:3000",
        )

    def test_allows_127_frontend_origin(self):
        client = TestClient(app)

        response = client.options(
            "/api/research/execute",
            headers={
                "Origin": "http://127.0.0.1:3000",
                "Access-Control-Request-Method": "POST",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["access-control-allow-origin"],
            "http://127.0.0.1:3000",
        )
