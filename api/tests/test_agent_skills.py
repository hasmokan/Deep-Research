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

    def test_skill_enabled_state_controls_active_loading(self):
        from agents.skills import load_skills, set_skill_enabled

        with TemporaryDirectory() as tmp:
            first = Path(tmp) / "first"
            second = Path(tmp) / "second"
            first.mkdir()
            second.mkdir()
            (first / "SKILL.md").write_text("First skill", encoding="utf-8")
            (second / "SKILL.md").write_text("Second skill", encoding="utf-8")

            set_skill_enabled(tmp, "second", False)

            active_skills = load_skills(tmp)
            all_skills = load_skills(tmp, include_disabled=True)

        self.assertEqual([skill.name for skill in active_skills], ["first"])
        self.assertEqual(
            [(skill.name, skill.enabled) for skill in all_skills],
            [("first", True), ("second", False)],
        )

    def test_save_and_delete_skill_round_trips_markdown(self):
        from agents.skills import delete_skill, load_skills, save_skill

        with TemporaryDirectory() as tmp:
            saved = save_skill(
                tmp,
                "custom-research",
                description="Custom guidance.",
                content="Prefer concise source-backed answers.",
                allowed_tools=["web_search"],
            )
            skills_after_save = load_skills(tmp, include_disabled=True)
            deleted = delete_skill(tmp, "custom-research")
            skills_after_delete = load_skills(tmp, include_disabled=True)

        self.assertEqual(saved.name, "custom-research")
        self.assertEqual(saved.description, "Custom guidance.")
        self.assertEqual(saved.allowed_tools, ["web_search"])
        self.assertEqual(skills_after_save[0].content, "Prefer concise source-backed answers.")
        self.assertTrue(deleted)
        self.assertEqual(skills_after_delete, [])
