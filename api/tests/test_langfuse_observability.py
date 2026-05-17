"""Langfuse observability hooks for research streams."""

import asyncio
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch


class FakeObservation:
    def __init__(self, tracer, name, payload):
        self.tracer = tracer
        self.name = name
        self.payload = payload
        self.updates = []

    def __enter__(self):
        self.tracer.observations.append(self)
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.tracer.closed.append(self.name)
        return False

    def update(self, **kwargs):
        self.updates.append(kwargs)


class FakeLangfuseTracer:
    def __init__(self):
        self.starts = []
        self.observations = []
        self.closed = []
        self.trace_updates = []
        self.flushed = False

    def start(self, name, **kwargs):
        self.starts.append((name, kwargs))
        return FakeObservation(self, name, kwargs)

    def update_current_trace(self, **kwargs):
        self.trace_updates.append(kwargs)

    def propagate_attributes(self, **kwargs):
        return FakeObservation(self, "propagate", kwargs)

    def flush(self):
        self.flushed = True


class FakePrompt:
    def __init__(self, chain):
        self.chain = chain

    def __or__(self, llm):
        return self.chain


class FakeChainWithConfig:
    def __init__(self, response=None, chunks=None):
        self.response = response or SimpleNamespace(content="ok", additional_kwargs={})
        self.chunks = chunks or []
        self.ainvoke_config = None
        self.astream_config = None

    async def ainvoke(self, payload, config=None):
        self.ainvoke_config = config
        return self.response

    async def astream(self, payload, config=None):
        self.astream_config = config
        for chunk in self.chunks:
            yield chunk


class FakeLangchainConfigTracer:
    def __init__(self):
        self.calls = []

    def langchain_config(self, run_name, metadata=None):
        self.calls.append((run_name, metadata))
        return {
            "callbacks": ["langfuse-callback"],
            "run_name": run_name,
            "metadata": metadata or {},
        }


class LangfuseObservabilityTests(TestCase):
    def test_langchain_config_is_empty_without_complete_credentials(self):
        from services.langfuse_observability import LangfuseTracer

        settings = SimpleNamespace(
            langfuse_enabled=True,
            langfuse_public_key="",
            langfuse_secret_key="",
            langfuse_base_url="https://cloud.langfuse.com",
            langfuse_environment="development",
            langfuse_release=None,
            langfuse_sample_rate=1.0,
        )

        tracer = LangfuseTracer(settings=settings)

        self.assertEqual(tracer.client, None)
        self.assertEqual(tracer.langchain_config("test-run"), {})

    def test_langchain_config_adds_callback_and_metadata_when_enabled(self):
        from services.langfuse_observability import LangfuseTracer

        class FakeCallbackHandler:
            def __init__(self):
                pass

        settings = SimpleNamespace(
            langfuse_enabled=True,
            langfuse_public_key="pk-test",
            langfuse_secret_key="sk-test",
            langfuse_base_url="https://cloud.langfuse.com",
            langfuse_environment="development",
            langfuse_release=None,
            langfuse_sample_rate=1.0,
        )

        tracer = LangfuseTracer(settings=settings)
        tracer._client = object()

        with patch("services.langfuse_observability._load_langchain_callback_handler", return_value=FakeCallbackHandler):
            config = tracer.langchain_config(
                "analyze-llm",
                metadata={"stage": "analyze", "raw": None},
            )

        self.assertEqual(config["run_name"], "analyze-llm")
        self.assertEqual(config["metadata"], {"stage": "analyze"})
        self.assertEqual(len(config["callbacks"]), 1)
        self.assertIsInstance(config["callbacks"][0], FakeCallbackHandler)

    def test_propagate_attributes_returns_context_manager_with_session_tags(self):
        from services.langfuse_observability import LangfuseTracer

        captured = {}

        def fake_propagate_attributes(**kwargs):
            captured.update(kwargs)
            return FakeObservation(FakeLangfuseTracer(), "propagate", {})

        settings = SimpleNamespace(
            langfuse_enabled=True,
            langfuse_public_key="pk-test",
            langfuse_secret_key="sk-test",
            langfuse_base_url="https://cloud.langfuse.com",
            langfuse_environment="development",
            langfuse_release=None,
            langfuse_sample_rate=1.0,
        )

        tracer = LangfuseTracer(settings=settings)
        tracer._client = object()

        with patch("services.langfuse_observability._load_propagate_attributes", return_value=fake_propagate_attributes):
            with tracer.propagate_attributes(
                session_id="run-langfuse",
                tags=["deep-research", "sse"],
                metadata={"run_id": "run-langfuse"},
            ):
                pass

        self.assertEqual(captured["session_id"], "run-langfuse")
        self.assertEqual(captured["tags"], ["deep-research", "sse"])
        self.assertEqual(captured["metadata"], {"run_id": "run-langfuse"})

    def test_analyze_node_passes_langchain_callback_config(self):
        from agents.nodes import analyze

        tracer = FakeLangchainConfigTracer()
        chain = FakeChainWithConfig(
            response=SimpleNamespace(content="analysis", additional_kwargs={})
        )

        with (
            patch.object(analyze, "get_langfuse_tracer", return_value=tracer),
            patch.object(analyze.ChatPromptTemplate, "from_messages", return_value=FakePrompt(chain)),
            patch.object(analyze, "ChatOpenAI"),
        ):
            asyncio.run(analyze.analyze_node({
                "query": "test query",
                "documents": [{"content": "doc", "similarity": 1.0}],
            }))

        self.assertEqual(tracer.calls[0][0], "analyze-llm")
        self.assertEqual(tracer.calls[0][1]["stage"], "analyze")
        self.assertEqual(chain.ainvoke_config["callbacks"], ["langfuse-callback"])

    def test_stream_generate_node_passes_langchain_callback_config(self):
        from agents.nodes import generate

        tracer = FakeLangchainConfigTracer()
        chain = FakeChainWithConfig(
            chunks=[SimpleNamespace(content="# Report", additional_kwargs={})]
        )

        with (
            patch.object(generate, "get_langfuse_tracer", return_value=tracer),
            patch.object(generate.ChatPromptTemplate, "from_messages", return_value=FakePrompt(chain)),
            patch.object(generate, "ChatOpenAI"),
        ):
            asyncio.run(_drain_node_events(generate.stream_generate_node({
                "query": "test query",
                "documents": [{"content": "doc"}],
                "analysis": "analysis",
            })))

        self.assertEqual(tracer.calls[0][0], "report-llm")
        self.assertEqual(tracer.calls[0][1]["stage"], "report")
        self.assertEqual(chain.astream_config["callbacks"], ["langfuse-callback"])

    def test_stream_records_research_run_observations(self):
        from agents import research_stream

        tracer = FakeLangfuseTracer()

        async def fake_web_search_node(state):
            return {
                "documents": [
                    {
                        "id": "web_0",
                        "content": "**Qingju Bikes Market Share**\n\nUseful source text.",
                        "metadata": {
                            "title": "Qingju Bikes Market Share",
                            "url": "https://example.com/qingju",
                            "source": "example.com",
                            "provider": "duckduckgo",
                            "type": "web_search",
                            "rank_score": 21,
                        },
                        "similarity": 1.0,
                    }
                ],
                "web_search_completed": True,
            }

        async def fake_analyze_node(state):
            yield {
                "type": "final",
                "state": {
                    "analysis": "Qingju is relevant.",
                    "analysis_completed": True,
                },
            }

        async def fake_generate_node(state):
            yield {
                "type": "final",
                "state": {
                    "report": "# Report\n\nQingju is relevant.",
                    "report_completed": True,
                },
            }

        with (
            patch.object(research_stream, "get_langfuse_tracer", return_value=tracer),
            patch.object(research_stream, "web_search_node", fake_web_search_node),
            patch.object(research_stream, "stream_analyze_node", fake_analyze_node),
            patch.object(research_stream, "stream_generate_node", fake_generate_node),
        ):
            asyncio.run(_drain_stream(research_stream.stream_research_events(
                "青橘单车 市场占有率",
                run_id="run-langfuse",
            )))

        span_names = [name for name, _payload in tracer.starts]
        self.assertEqual(span_names[:4], [
            "research-run",
            "intent-routing",
            "web-search",
            "analyze-llm",
        ])
        self.assertIn("report-llm", span_names)
        self.assertTrue(tracer.flushed)
        self.assertEqual(tracer.trace_updates[0]["session_id"], "run-langfuse")

        search_observation = _observation_by_name(tracer, "web-search")
        self.assertEqual(search_observation.payload["input"]["query"], "青橘单车 市场占有率")
        self.assertEqual(search_observation.updates[-1]["output"]["documents_count"], 1)
        self.assertEqual(
            search_observation.updates[-1]["output"]["documents"][0]["title"],
            "Qingju Bikes Market Share",
        )

        report_observation = _observation_by_name(tracer, "report-llm")
        self.assertEqual(report_observation.payload["as_type"], "span")
        self.assertIn("Qingju is relevant", report_observation.updates[-1]["output"]["report_preview"])


async def _drain_stream(stream):
    async for _event in stream:
        pass


async def _drain_node_events(stream):
    return [event async for event in stream]


def _observation_by_name(tracer, name):
    for observation in tracer.observations:
        if observation.name == name:
            return observation
    raise AssertionError(f"missing observation {name}")
