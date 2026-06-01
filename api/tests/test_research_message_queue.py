"""Research job message queue tests."""

from __future__ import annotations

import asyncio
import json
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import patch


class FakeRedis:
    def __init__(self):
        self.entries = []
        self.acked = []
        self.closed = False

    async def xgroup_create(self, *, name, groupname, id="0-0", mkstream=False):
        self.group = {
            "name": name,
            "groupname": groupname,
            "id": id,
            "mkstream": mkstream,
        }

    async def xadd(self, name, fields):
        message_id = f"{len(self.entries) + 1}-0"
        self.entries.append((name, message_id, fields))
        return message_id

    async def xreadgroup(self, *, groupname, consumername, streams, count, block):
        del groupname, consumername, count, block
        stream_name = next(iter(streams))
        for index, (name, message_id, fields) in enumerate(self.entries):
            if name == stream_name:
                self.entries.pop(index)
                return [(name, [(message_id, fields)])]
        await asyncio.sleep(0)
        return []

    async def xack(self, name, groupname, message_id):
        self.acked.append((name, groupname, message_id))
        return 1

    async def aclose(self):
        self.closed = True


def _job():
    from services.message_queue import ResearchRunJob

    return ResearchRunJob(
        contextual_query="contextual query",
        run_id="run-1",
        user_id="user-1",
        thread_id="thread-1",
        trace_id="trace-1",
        display_query="visible query",
        latest_result={"answer": "previous"},
        execution_mode="react",
    )


class ResearchMessageQueueTests(IsolatedAsyncioTestCase):
    async def test_memory_queue_sends_and_receives_research_job(self):
        from services.message_queue import MemoryResearchJobQueue

        queue = MemoryResearchJobQueue()
        await queue.send(_job())

        queued = await asyncio.wait_for(queue.receive(), timeout=1)
        await queue.ack(queued)

        self.assertEqual(queued.job.run_id, "run-1")
        self.assertEqual(queued.job.contextual_query, "contextual query")
        self.assertEqual(queued.job.latest_result, {"answer": "previous"})

    async def test_redis_queue_sends_receives_and_acks_research_job(self):
        from services.message_queue import RedisResearchJobQueue

        fake = FakeRedis()
        queue = RedisResearchJobQueue(
            redis_url="redis://localhost:6379/0",
            stream_name="test:research:jobs",
            group_name="test-group",
            redis_factory=lambda _url: fake,
        )

        await queue.start()
        await queue.send(_job())
        payload = json.loads(fake.entries[0][2]["payload"])

        queued = await asyncio.wait_for(queue.receive(), timeout=1)
        await queue.ack(queued)
        await queue.close()

        self.assertEqual(fake.group["name"], "test:research:jobs")
        self.assertEqual(fake.group["groupname"], "test-group")
        self.assertTrue(fake.group["mkstream"])
        self.assertEqual(queued.message_id, "1-0")
        self.assertEqual(queued.job.run_id, "run-1")
        self.assertEqual(queued.job.thread_id, "thread-1")
        self.assertEqual(queued.job.execution_mode, "react")
        self.assertEqual(fake.acked, [("test:research:jobs", "test-group", "1-0")])
        self.assertTrue(fake.closed)
        self.assertEqual(payload["run_id"], "run-1")
        self.assertEqual(payload["contextual_query"], "contextual query")


class ResearchMessageQueueFactoryTests(TestCase):
    def test_factory_uses_redis_backend_from_settings(self):
        from services.message_queue import RedisResearchJobQueue, create_research_job_queue

        class Settings:
            research_queue_backend = "redis"
            redis_url = "redis://redis:6379/0"
            research_queue_stream = "custom:jobs"
            research_queue_group = "custom-group"
            research_queue_consumer = "custom-consumer"

        queue = create_research_job_queue(Settings())

        self.assertIsInstance(queue, RedisResearchJobQueue)
        self.assertEqual(queue.stream_name, "custom:jobs")
        self.assertEqual(queue.group_name, "custom-group")
        self.assertEqual(queue.consumer_name, "custom-consumer")

    def test_start_research_run_background_enqueues_job(self):
        from routers import research

        captured = []

        class FakeQueue:
            async def send(self, job):
                captured.append(job)

        async def run_case():
            with (
                patch.object(research, "research_job_queue", FakeQueue()),
                patch.object(research, "ensure_research_job_worker_started"),
            ):
                task = research.start_research_run_background(
                    "contextual query",
                    run_id="run-1",
                    user_id="user-1",
                    thread_id="thread-1",
                    trace_id="trace-1",
                    display_query="visible query",
                    latest_result={"answer": "previous"},
                    execution_mode="react",
                )
                await asyncio.wait_for(task, timeout=1)

        asyncio.run(run_case())

        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0].run_id, "run-1")
        self.assertEqual(captured[0].contextual_query, "contextual query")
        self.assertEqual(captured[0].latest_result, {"answer": "previous"})

    def test_start_research_run_background_records_stream_error_when_enqueue_fails(self):
        from routers import research

        appended = []

        class FakeQueue:
            async def send(self, job):
                del job
                raise RuntimeError("redis unavailable")

        class FakeStore:
            def append_event(self, run_id, event, data):
                appended.append((run_id, event, data))

        async def run_case():
            with (
                patch.object(research, "research_job_queue", FakeQueue()),
                patch.object(research, "research_run_store", FakeStore()),
                patch.object(research, "ensure_research_job_worker_started"),
            ):
                task = research.start_research_run_background(
                    "contextual query",
                    run_id="run-1",
                    user_id="user-1",
                    trace_id="trace-1",
                )
                await asyncio.wait_for(task, timeout=1)

        asyncio.run(run_case())

        self.assertEqual(appended[0][0], "run-1")
        self.assertEqual(appended[0][1], "stream_error")
        self.assertIn("Research queue enqueue failed", appended[0][2]["detail"])
        self.assertEqual(appended[0][2]["trace_id"], "trace-1")
