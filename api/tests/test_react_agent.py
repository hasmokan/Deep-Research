"""Minimal ReAct agent loop behavior."""

from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase


class ReactAgentTests(IsolatedAsyncioTestCase):
    async def test_streams_reason_action_observation_then_final_answer(self):
        from agents.react_agent import stream_react_agent_messages

        responses = [
            SimpleNamespace(
                id="ai-1",
                content="",
                additional_kwargs={"reasoning_content": "Need public evidence before answering."},
                tool_calls=[
                    {
                        "id": "call-1",
                        "name": "web_search",
                        "args": {"query": "hasmokan GitHub"},
                    }
                ],
            ),
            SimpleNamespace(
                id="ai-2",
                content="hasmokan appears to be a GitHub user.",
                additional_kwargs={"reasoning_content": "The search result is enough for a cautious answer."},
                tool_calls=[],
            ),
        ]

        class FakeModel:
            def __init__(self):
                self.calls = 0

            async def ainvoke(self, messages, config=None):
                response = responses[self.calls]
                self.calls += 1
                return response

        async def fake_tool_runner(name, args):
            self.assertEqual(name, "web_search")
            self.assertEqual(args, {"query": "hasmokan GitHub"})
            return [{"title": "hasmokan - GitHub", "url": "https://github.com/hasmokan"}]

        events = [
            event
            async for event in stream_react_agent_messages(
                "谁是 hasmokan",
                model=FakeModel(),
                tool_runner=fake_tool_runner,
            )
        ]

        self.assertEqual([event["type"] for event in events], ["agent_message", "agent_message", "agent_message", "final"])
        self.assertEqual(events[0]["message"]["type"], "ai")
        self.assertEqual(events[0]["message"]["reasoning_content"], "Need public evidence before answering.")
        self.assertEqual(events[0]["message"]["tool_calls"][0]["name"], "web_search")
        self.assertEqual(events[1]["message"]["type"], "tool")
        self.assertEqual(events[1]["message"]["tool_call_id"], "call-1")
        self.assertEqual(events[1]["message"]["name"], "web_search")
        self.assertIn("hasmokan - GitHub", events[1]["message"]["content"])
        self.assertEqual(events[2]["message"]["content"], "hasmokan appears to be a GitHub user.")
        self.assertEqual(events[3]["answer"], "hasmokan appears to be a GitHub user.")

    async def test_stops_for_clarification_tool_call(self):
        from agents.react_agent import stream_react_agent_messages

        class FakeModel:
            async def ainvoke(self, messages, config=None):
                return SimpleNamespace(
                    id="ai-clarify",
                    content="",
                    additional_kwargs={"reasoning_content": "The name is ambiguous."},
                    tool_calls=[
                        {
                            "id": "call-clarify",
                            "name": "ask_clarification",
                            "args": {
                                "question": "你是想问 hasokan，还是 hasmokan？",
                                "options": ["hasokan", "hasmokan", "提供更多上下文"],
                            },
                        }
                    ],
                )

        events = [
            event
            async for event in stream_react_agent_messages(
                "谁是 hasokan",
                model=FakeModel(),
            )
        ]

        self.assertEqual([event["type"] for event in events], ["agent_message", "agent_message", "clarification"])
        self.assertEqual(events[1]["message"]["type"], "tool")
        self.assertEqual(events[1]["message"]["name"], "ask_clarification")
        self.assertIn("你是想问 hasokan", events[1]["message"]["content"])
        self.assertEqual(events[2]["question"], "你是想问 hasokan，还是 hasmokan？")

    async def test_injects_skill_content_into_system_prompt(self):
        from agents.react_agent import stream_react_agent_messages
        from agents.skills import AgentSkill

        captured_system_prompts = []

        class FakeModel:
            async def ainvoke(self, messages, config=None):
                captured_system_prompts.append(messages[0].content)
                return SimpleNamespace(
                    id="ai-final",
                    content="Use source-backed identity checks.",
                    additional_kwargs={},
                    tool_calls=[],
                )

        events = [
            event
            async for event in stream_react_agent_messages(
                "谁是 hasmokan",
                model=FakeModel(),
                skills=[
                    AgentSkill(
                        name="identity-research",
                        description="Identity research guidance.",
                        content="Prefer source-backed identity checks before answering.",
                        allowed_tools=["web_search"],
                    )
                ],
            )
        ]

        self.assertEqual(events[-1]["answer"], "Use source-backed identity checks.")
        self.assertIn("identity-research", captured_system_prompts[0])
        self.assertIn("Prefer source-backed identity checks", captured_system_prompts[0])

    def test_filters_react_tools_with_skill_allowed_tools(self):
        from agents.react_agent import available_react_tools_for_skills
        from agents.skills import AgentSkill

        tools = available_react_tools_for_skills(
            [AgentSkill(name="search-only", content="", allowed_tools=["web_search"])]
        )

        self.assertEqual([tool.name for tool in tools], ["web_search"])
