"""Minimal ReAct agent loop behavior."""

from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch


class ReactAgentTests(IsolatedAsyncioTestCase):
    async def test_uses_langchain_create_agent_runtime(self):
        from agents import react_agent

        calls = {}

        class FakeAgentRuntime:
            async def astream(self, inputs, config=None, stream_mode=None, version=None):
                calls["inputs"] = inputs
                calls["config"] = config
                calls["stream_mode"] = stream_mode
                calls["version"] = version
                yield {
                    "type": "updates",
                    "data": {
                        "model": {
                            "messages": [
                                SimpleNamespace(
                                    id="ai-final",
                                    content="Runtime final answer.",
                                    additional_kwargs={},
                                    tool_calls=[],
                                )
                            ]
                        }
                    },
                }

        def fake_create_agent(**kwargs):
            calls["create_agent"] = kwargs
            return FakeAgentRuntime()

        with patch.object(react_agent, "create_agent", fake_create_agent):
            events = [
                event
                async for event in react_agent.stream_react_agent_messages(
                    "Use the runtime",
                    model=SimpleNamespace(),
                    skills=[],
                )
            ]

        self.assertEqual(calls["create_agent"]["model"], SimpleNamespace())
        self.assertEqual(calls["create_agent"]["tools"], [react_agent.web_search_tool, react_agent.ask_clarification_tool])
        self.assertIn("ReAct research assistant", calls["create_agent"]["system_prompt"])
        self.assertEqual(calls["inputs"]["messages"][0].content, "Use the runtime")
        self.assertEqual(calls["stream_mode"], ["updates"])
        self.assertEqual(calls["version"], "v2")
        self.assertEqual(events[-1], {"type": "final", "answer": "Runtime final answer."})

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

    async def test_persists_large_tool_result_before_model_observes_it(self):
        from langchain_core.messages import ToolMessage

        from agents import react_agent
        from agents.context_compression import persist_large_output

        class FakeModel:
            def __init__(self):
                self.calls = 0
                self.invocations = []

            async def ainvoke(self, messages, config=None):
                self.invocations.append(list(messages))
                self.calls += 1
                if self.calls == 1:
                    return SimpleNamespace(
                        id="ai-search",
                        content="",
                        additional_kwargs={},
                        tool_calls=[
                            {
                                "id": "call-large-search",
                                "name": "web_search",
                                "args": {"query": "large result"},
                            }
                        ],
                    )
                return SimpleNamespace(
                    id="ai-final",
                    content="Used persisted output marker.",
                    additional_kwargs={},
                    tool_calls=[],
                )

        async def fake_tool_runner(name, args):
            return "abcdefghijklmnopqrstuvwxyz"

        with TemporaryDirectory() as temp_dir:
            def persist_for_test(tool_use_id, output):
                return persist_large_output(
                    tool_use_id,
                    output,
                    output_dir=Path(temp_dir),
                    threshold=10,
                    preview_chars=8,
                )

            model = FakeModel()
            with patch.object(react_agent, "persist_large_output", persist_for_test):
                events = [
                    event
                    async for event in react_agent.stream_react_agent_messages(
                        "Find large result",
                        model=model,
                        tool_runner=fake_tool_runner,
                    )
                ]

            tool_event = events[1]["message"]["content"]
            observed_tool_messages = [
                message for message in model.invocations[1] if isinstance(message, ToolMessage)
            ]

            self.assertIn("<persisted-output>", tool_event)
            self.assertIn("Preview:\nabcdefgh", tool_event)
            self.assertNotIn("ijklmnopqrstuvwxyz", tool_event)
            self.assertIn("<persisted-output>", observed_tool_messages[0].content)

            saved_path = Path(tool_event.split("Full output saved to: ", 1)[1].splitlines()[0])
            self.assertEqual(saved_path.read_text(encoding="utf-8"), "abcdefghijklmnopqrstuvwxyz")
            self.assertEqual(events[-1]["answer"], "Used persisted output marker.")

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

    async def test_synthesizes_final_answer_when_tool_rounds_are_exhausted(self):
        from agents.react_agent import stream_react_agent_messages

        internal_fallback = "I reached the maximum number of ReAct tool rounds before producing a final answer."

        class FakeModel:
            def __init__(self):
                self.calls = 0
                self.invocations = []

            async def ainvoke(self, messages, config=None):
                self.invocations.append(list(messages))
                self.calls += 1
                if self.calls <= 2:
                    return SimpleNamespace(
                        id=f"ai-{self.calls}",
                        content="",
                        additional_kwargs={},
                        tool_calls=[
                            {
                                "id": f"call-{self.calls}",
                                "name": "web_search",
                                "args": {"query": f"hasmokan source {self.calls}"},
                            }
                        ],
                    )
                return SimpleNamespace(
                    id="ai-synthesis",
                    content="Based on the gathered results, hasmokan appears to be a GitHub user.",
                    additional_kwargs={},
                    tool_calls=[],
                )

        async def fake_tool_runner(name, args):
            return [{"title": f"Result for {args['query']}", "url": "https://example.test/result"}]

        model = FakeModel()
        events = [
            event
            async for event in stream_react_agent_messages(
                "谁是 hasmokan",
                model=model,
                tool_runner=fake_tool_runner,
                max_rounds=2,
            )
        ]

        self.assertEqual(events[-1]["type"], "final")
        self.assertEqual(
            events[-1]["answer"],
            "Based on the gathered results, hasmokan appears to be a GitHub user.",
        )
        self.assertNotEqual(events[-1]["answer"], internal_fallback)
        self.assertEqual(model.calls, 3)
        self.assertIn("stop calling tools", model.invocations[-1][-1].content.lower())

    async def test_final_synthesis_micro_compacts_older_tool_results(self):
        from langchain_core.messages import ToolMessage

        from agents.react_agent import stream_react_agent_messages

        class FakeModel:
            def __init__(self):
                self.calls = 0
                self.invocations = []

            async def ainvoke(self, messages, config=None):
                self.invocations.append(list(messages))
                self.calls += 1
                if self.calls <= 4:
                    return SimpleNamespace(
                        id=f"ai-{self.calls}",
                        content="",
                        additional_kwargs={},
                        tool_calls=[
                            {
                                "id": f"call-{self.calls}",
                                "name": "web_search",
                                "args": {"query": f"source {self.calls}"},
                            }
                        ],
                    )
                return SimpleNamespace(
                    id="ai-synthesis",
                    content="Final answer from compacted evidence.",
                    additional_kwargs={},
                    tool_calls=[],
                )

        async def fake_tool_runner(name, args):
            return [{"title": f"Result {args['query']}", "url": f"https://example.test/{args['query']}"}]

        model = FakeModel()
        events = [
            event
            async for event in stream_react_agent_messages(
                "Gather enough sources",
                model=model,
                tool_runner=fake_tool_runner,
                max_rounds=4,
            )
        ]

        synthesis_tool_messages = [
            message for message in model.invocations[-1] if isinstance(message, ToolMessage)
        ]
        self.assertEqual(synthesis_tool_messages[0].content, "[Earlier tool result omitted for brevity]")
        self.assertIn("Result source 2", synthesis_tool_messages[1].content)
        self.assertIn("Result source 3", synthesis_tool_messages[2].content)
        self.assertIn("Result source 4", synthesis_tool_messages[3].content)
        self.assertEqual(events[-1]["answer"], "Final answer from compacted evidence.")

    async def test_runtime_carries_repeated_tool_observations_between_model_calls(self):
        from langchain_core.messages import ToolMessage

        from agents.react_agent import stream_react_agent_messages

        class FakeModel:
            def __init__(self):
                self.calls = 0
                self.invocations = []

            async def ainvoke(self, messages, config=None):
                self.invocations.append(list(messages))
                self.calls += 1
                if self.calls <= 3:
                    return SimpleNamespace(
                        id=f"ai-{self.calls}",
                        content="",
                        additional_kwargs={},
                        tool_calls=[
                            {
                                "id": f"call-{self.calls}",
                                "name": "web_search",
                                "args": {"query": "same repeated query"},
                            }
                        ],
                    )
                return SimpleNamespace(
                    id="ai-final",
                    content="The repeated search results point to the same answer.",
                    additional_kwargs={},
                    tool_calls=[],
                )

        async def fake_tool_runner(name, args):
            return [{"title": "Repeated result", "url": "https://example.test/repeated"}]

        model = FakeModel()
        events = [
            event
            async for event in stream_react_agent_messages(
                "Find repeated information",
                model=model,
                tool_runner=fake_tool_runner,
                max_rounds=4,
            )
        ]

        third_invocation = model.invocations[2]
        self.assertIsInstance(third_invocation[-1], ToolMessage)
        self.assertIn("Repeated result", third_invocation[-1].content)
        self.assertEqual(events[-1]["answer"], "The repeated search results point to the same answer.")

    async def test_does_not_emit_unpaired_tool_calls_from_final_synthesis(self):
        from agents.react_agent import stream_react_agent_messages

        class FakeModel:
            def __init__(self):
                self.calls = 0

            async def ainvoke(self, messages, config=None):
                self.calls += 1
                if self.calls == 1:
                    return SimpleNamespace(
                        id="ai-search",
                        content="",
                        additional_kwargs={},
                        tool_calls=[
                            {
                                "id": "call-search",
                                "name": "web_search",
                                "args": {"query": "hasmokan source"},
                            }
                        ],
                    )
                return SimpleNamespace(
                    id="ai-bad-synthesis",
                    content="",
                    additional_kwargs={},
                    tool_calls=[
                        {
                            "id": "call-unpaired",
                            "name": "web_search",
                            "args": {"query": "another source"},
                        }
                    ],
                )

        async def fake_tool_runner(name, args):
            return [{"title": "Gathered source", "url": "https://example.test/source"}]

        events = [
            event
            async for event in stream_react_agent_messages(
                "Find information",
                model=FakeModel(),
                tool_runner=fake_tool_runner,
                max_rounds=1,
            )
        ]

        emitted_tool_calls = [
            tool_call
            for event in events
            if event["type"] == "agent_message"
            for tool_call in event["message"].get("tool_calls", [])
        ]
        self.assertEqual(emitted_tool_calls, [{"id": "call-search", "name": "web_search", "args": {"query": "hasmokan source"}}])
        self.assertEqual(events[-1]["type"], "final")
        self.assertIn("partial answer", events[-1]["answer"])
        self.assertIn("Gathered source", events[-1]["answer"])

    async def test_exposes_skill_catalog_without_injecting_full_content(self):
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
        self.assertIn("Identity research guidance.", captured_system_prompts[0])
        self.assertNotIn("Prefer source-backed identity checks", captured_system_prompts[0])

    async def test_load_skill_tool_injects_skill_content_on_next_model_call(self):
        from agents.react_agent import stream_react_agent_messages
        from agents.skills import AgentSkill

        captured_invocations = []

        class FakeModel:
            def __init__(self):
                self.calls = 0

            async def ainvoke(self, messages, config=None):
                captured_invocations.append(list(messages))
                self.calls += 1
                if self.calls == 1:
                    return SimpleNamespace(
                        id="ai-load-skill",
                        content="",
                        additional_kwargs={},
                        tool_calls=[
                            {
                                "id": "call-load-skill",
                                "name": "load_skill",
                                "args": {"name": "identity-research"},
                            }
                        ],
                    )
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

        self.assertEqual([event["type"] for event in events], ["agent_message", "trace", "agent_message", "final"])
        self.assertNotIn("Prefer source-backed identity checks", captured_invocations[0][0].content)
        self.assertIn("Prefer source-backed identity checks", captured_invocations[1][-1].content)
        self.assertEqual(events[1]["kind"], "skill")
        self.assertEqual(events[1]["title"], "Skill loaded")
        self.assertEqual(events[1]["skills"][0]["name"], "identity-research")
        self.assertEqual(events[-1]["answer"], "Use source-backed identity checks.")

    def test_filters_react_tools_with_skill_allowed_tools(self):
        from agents.react_agent import available_react_tools_for_skills
        from agents.skills import AgentSkill

        tools = available_react_tools_for_skills(
            [AgentSkill(name="search-only", content="", allowed_tools=["web_search"])]
        )

        self.assertEqual([tool.name for tool in tools], ["load_skill", "web_search"])
