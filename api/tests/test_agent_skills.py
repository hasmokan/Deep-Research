"""Local agent skill loading and tool policy behavior."""

from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase


class AgentSkillsTests(TestCase):
    def test_load_skills_reads_frontmatter_and_body(self):
        from agents.skills import load_skills

        with TemporaryDirectory() as tmp:
            skill_dir = Path(tmp) / "research-helper"
            skill_dir.mkdir()
            (skill_dir / "SKILL.md").write_text(
                """---
name: research-helper
description: Prefer source-backed answers.
allowed-tools:
  - web_search
  - ask_clarification
---
Use public sources before answering identity questions.
""",
                encoding="utf-8",
            )

            skills = load_skills(tmp)

        self.assertEqual(len(skills), 1)
        self.assertEqual(skills[0].name, "research-helper")
        self.assertEqual(skills[0].description, "Prefer source-backed answers.")
        self.assertEqual(skills[0].allowed_tools, ["web_search", "ask_clarification"])
        self.assertIn("Use public sources", skills[0].content)

    def test_load_skills_can_filter_by_enabled_names(self):
        from agents.skills import load_skills

        with TemporaryDirectory() as tmp:
            first = Path(tmp) / "first"
            second = Path(tmp) / "second"
            first.mkdir()
            second.mkdir()
            (first / "SKILL.md").write_text("First skill", encoding="utf-8")
            (second / "SKILL.md").write_text("Second skill", encoding="utf-8")

            skills = load_skills(tmp, enabled_names=["second"])

        self.assertEqual([skill.name for skill in skills], ["second"])
        self.assertEqual(skills[0].content, "Second skill")

    def test_tool_policy_allows_all_without_restrictions(self):
        from agents.skills import AgentSkill, filter_tools_by_skill_allowed_tools

        tools = [SimpleNamespace(name="web_search"), SimpleNamespace(name="ask_clarification")]

        self.assertEqual(
            filter_tools_by_skill_allowed_tools(
                tools,
                [AgentSkill(name="general", content="General guidance.")],
            ),
            tools,
        )

    def test_tool_policy_filters_union_of_declared_allowed_tools(self):
        from agents.skills import AgentSkill, filter_tools_by_skill_allowed_tools

        tools = [
            SimpleNamespace(name="web_search"),
            SimpleNamespace(name="ask_clarification"),
            SimpleNamespace(name="bash"),
        ]

        filtered = filter_tools_by_skill_allowed_tools(
            tools,
            [
                AgentSkill(name="research", content="", allowed_tools=["web_search"]),
                AgentSkill(name="clarify", content="", allowed_tools=["ask_clarification"]),
            ],
        )

        self.assertEqual([tool.name for tool in filtered], ["web_search", "ask_clarification"])
