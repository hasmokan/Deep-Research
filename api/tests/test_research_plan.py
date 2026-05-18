"""Research plan API behavior."""

from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app
from services.auth import AuthenticatedUser, get_current_user


class ResearchPlanRouteTests(TestCase):
    def setUp(self):
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(user_id="user-1")
        self.memory_patcher = patch("routers.research.research_memory_store", EmptyMemoryStore())
        self.memory_patcher.start()

    def tearDown(self):
        app.dependency_overrides.clear()
        self.memory_patcher.stop()

    def test_plan_endpoint_returns_generated_research_plan(self):
        client = TestClient(app)
        generated_plan = {
            "query": "Compare AI search products",
            "source_label": "Public web",
            "summary": "Compare AI search products by source coverage, UX, and report quality.",
            "steps": [
                {
                    "id": "scope",
                    "title": "Define comparison criteria",
                    "detail": "Clarify products, dimensions, and the evidence needed for a useful comparison.",
                },
                {
                    "id": "sources",
                    "title": "Collect product and review sources",
                    "detail": "Use official pages, documentation, reviews, and recent benchmark discussions.",
                },
                {
                    "id": "evidence",
                    "title": "Compare evidence across sources",
                    "detail": "Separate vendor claims from independent observations and identify tradeoffs.",
                },
                {
                    "id": "report",
                    "title": "Write the recommendation",
                    "detail": "Summarize findings with citations and call out where evidence is uncertain.",
                },
            ],
        }

        async def fake_generate_research_plan(query: str):
            self.assertEqual(query, "Compare AI search products")
            return generated_plan

        with (
            patch(
                "routers.research.assess_research_plan_need",
                return_value={"should_plan": True, "reason": "Broad research task."},
            ),
            patch(
                "routers.research.generate_research_plan",
                side_effect=fake_generate_research_plan,
            ),
        ):
            response = client.post(
                "/api/research/plan",
                json={"query": "Compare AI search products"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {**generated_plan, "should_plan": True})

    def test_plan_endpoint_does_not_persist_thread_snapshots(self):
        client = TestClient(app)
        generated_plan = {
            "query": "Compare AI search products",
            "source_label": "Public web",
            "summary": "Compare AI search products by source coverage, UX, and report quality.",
            "steps": [],
        }

        class DisabledThreadStore:
            def upsert_thread(self, *_args, **_kwargs):
                raise AssertionError("plan generation must not persist server-side threads")

        async def fake_generate_research_plan(query: str):
            self.assertEqual(query, "Compare AI search products")
            return generated_plan

        with (
            patch("routers.research.research_thread_store", DisabledThreadStore(), create=True),
            patch(
                "routers.research.assess_research_plan_need",
                return_value={"should_plan": True, "reason": "Broad research task."},
            ),
            patch(
                "routers.research.generate_research_plan",
                side_effect=fake_generate_research_plan,
            ),
        ):
            response = client.post(
                "/api/research/plan",
                json={
                    "query": "Compare AI search products",
                    "thread_id": "session-local-only",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {**generated_plan, "should_plan": True})

    def test_plan_stream_endpoint_emits_status_plan_and_complete_events(self):
        client = TestClient(app)
        generated_plan = {
            "query": "Compare AI search products",
            "source_label": "Public web",
            "summary": "Compare AI search products by source coverage, UX, and report quality.",
            "steps": [
                {
                    "id": "scope",
                    "title": "Define comparison criteria",
                    "detail": "Clarify products, dimensions, and the evidence needed for a useful comparison.",
                },
                {
                    "id": "sources",
                    "title": "Collect product and review sources",
                    "detail": "Use official pages, documentation, reviews, and recent benchmark discussions.",
                },
                {
                    "id": "evidence",
                    "title": "Compare evidence across sources",
                    "detail": "Separate vendor claims from independent observations and identify tradeoffs.",
                },
                {
                    "id": "report",
                    "title": "Write the recommendation",
                    "detail": "Summarize findings with citations and call out where evidence is uncertain.",
                },
            ],
        }

        async def fake_generate_research_plan(query: str):
            self.assertEqual(query, "Compare AI search products")
            return generated_plan

        with (
            patch(
                "routers.research.assess_research_plan_need",
                return_value={"should_plan": True, "reason": "Broad research task."},
            ),
            patch(
                "routers.research.generate_research_plan",
                side_effect=fake_generate_research_plan,
            ),
        ):
            response = client.post(
                "/api/research/plan/stream",
                json={"query": "Compare AI search products"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"].split(";")[0], "text/event-stream")

        events = _parse_sse_events(response.text)
        self.assertEqual([event["event"] for event in events], ["status", "status", "plan", "complete"])
        self.assertEqual(events[0]["data"]["stage"], "plan")
        self.assertEqual(events[0]["data"]["label"], "Planning")
        self.assertEqual(events[2]["data"], {**generated_plan, "should_plan": True})
        self.assertEqual(events[3]["data"], {**generated_plan, "should_plan": True})

    def test_plan_endpoint_can_skip_plan_for_simple_follow_up(self):
        client = TestClient(app)

        async def fake_assess_research_plan_need(query: str):
            self.assertEqual(query, "来源是？")
            return {
                "should_plan": False,
                "reason": "Simple informational follow-up.",
            }

        with (
            patch(
                "routers.research.assess_research_plan_need",
                side_effect=fake_assess_research_plan_need,
            ),
            patch("routers.research.generate_research_plan") as generate_plan,
        ):
            response = client.post(
                "/api/research/plan",
                json={
                    "query": "来源是？",
                    "messages": [
                        {"role": "assistant", "content": "已有研究报告"},
                    ],
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["should_plan"])
        self.assertEqual(response.json()["steps"], [])
        generate_plan.assert_not_called()

    def test_plan_endpoint_forces_plan_for_first_turn_deep_research(self):
        client = TestClient(app)
        generated_plan = {
            "query": "调查一下青稞市场占用份额",
            "source_label": "Public web",
            "summary": "Research Qingke market share across public sources.",
            "steps": [
                {"id": "scope", "title": "Define the market", "detail": "Clarify the market and competitors."},
                {"id": "sources", "title": "Find market sources", "detail": "Collect public market share evidence."},
                {"id": "compare", "title": "Compare evidence", "detail": "Check consistency across sources."},
                {"id": "report", "title": "Draft report", "detail": "Summarize market share findings."},
            ],
        }

        async def fake_generate_research_plan(query: str):
            self.assertEqual(query, "调查一下青稞市场占用份额")
            return generated_plan

        with (
            patch(
                "routers.research.assess_research_plan_need",
                return_value={"should_plan": False, "reason": "Incorrectly skipped."},
            ) as assess_plan_need,
            patch(
                "routers.research.generate_research_plan",
                side_effect=fake_generate_research_plan,
            ),
        ):
            response = client.post(
                "/api/research/plan",
                json={"query": "调查一下青稞市场占用份额"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["should_plan"])
        self.assertEqual(response.json()["steps"][0]["title"], "Define the market")
        assess_plan_need.assert_not_called()


class ResearchPlanGenerationTests(IsolatedAsyncioTestCase):
    def test_plan_prompt_only_requires_query_variable(self):
        from agents.nodes.plan import _build_research_plan_prompt

        prompt = _build_research_plan_prompt()

        self.assertEqual(prompt.input_variables, ["query"])

    async def test_plan_generation_parses_model_json(self):
        from agents.nodes import plan

        class FakeResponse:
            content = """
            {
              "summary": "Investigate the market, source quality, and adoption signals.",
              "steps": [
                {"id": "scope", "title": "Scope the market", "detail": "Define product categories and comparison criteria."},
                {"id": "sources", "title": "Find sources", "detail": "Collect official pages, reviews, and recent analysis."},
                {"id": "compare", "title": "Compare claims", "detail": "Check agreement and disagreement across sources."},
                {"id": "report", "title": "Draft report", "detail": "Write a cited recommendation with caveats."}
              ]
            }
            """

        class FakeChain:
            async def ainvoke(self, payload):
                self.payload = payload
                return FakeResponse()

        class FakePrompt:
            def __or__(self, llm):
                return FakeChain()

        fake_settings = type(
            "Settings",
            (),
            {
                "openai_api_key": "api-key",
                "openai_base_url": "https://api.example.test/v1",
                "llm_model": "test-model",
            },
        )()

        with (
            patch.object(plan, "settings", fake_settings),
            patch.object(plan.ChatPromptTemplate, "from_messages", return_value=FakePrompt()),
            patch.object(plan, "ChatOpenAI") as chat_openai,
        ):
            result = await plan.generate_research_plan("AI search tools")

        chat_openai.assert_called_once_with(
            model="test-model",
            temperature=0.2,
            api_key="api-key",
            base_url="https://api.example.test/v1",
        )
        self.assertEqual(result["query"], "AI search tools")
        self.assertEqual(result["source_label"], "Public web")
        self.assertEqual(result["steps"][0]["title"], "Scope the market")

    async def test_plan_need_assessment_parses_model_json(self):
        from agents.nodes import plan

        class FakeResponse:
            content = '{"should_plan": false, "reason": "Simple source question."}'

        class FakeChain:
            async def ainvoke(self, payload):
                self.payload = payload
                return FakeResponse()

        class FakePrompt:
            def __or__(self, llm):
                return FakeChain()

        fake_settings = type(
            "Settings",
            (),
            {
                "openai_api_key": "api-key",
                "openai_base_url": "https://api.example.test/v1",
                "llm_model": "test-model",
            },
        )()

        with (
            patch.object(plan, "settings", fake_settings),
            patch.object(plan.ChatPromptTemplate, "from_messages", return_value=FakePrompt()),
            patch.object(plan, "ChatOpenAI"),
        ):
            result = await plan.assess_research_plan_need("来源是？")

        self.assertFalse(result["should_plan"])
        self.assertEqual(result["reason"], "Simple source question.")


def _parse_sse_events(text: str) -> list[dict]:
    events = []
    for block in text.strip().split("\n\n"):
        lines = block.splitlines()
        event = next(line.removeprefix("event: ").strip() for line in lines if line.startswith("event: "))
        data = "\n".join(line.removeprefix("data: ") for line in lines if line.startswith("data: "))
        events.append({"event": event, "data": __import__("json").loads(data)})
    return events


class EmptyMemoryStore:
    def get_memory(self, user_id):
        return {
            "user_id": user_id,
            "summary": "",
            "recent_topics": [],
            "updated_at": "2026-05-18T00:00:00+00:00",
        }

    def remember_result(self, user_id, result):
        return self.get_memory(user_id)
