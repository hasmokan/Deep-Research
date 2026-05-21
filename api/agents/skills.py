"""Minimal local skill loader for agent prompts and tool policy."""

from __future__ import annotations

import os
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

SKILL_FILE_NAME = "SKILL.md"

T = TypeVar("T")


@dataclass(frozen=True)
class AgentSkill:
    name: str
    content: str
    description: str = ""
    allowed_tools: list[str] | None = None
    path: Path | None = None


def default_skills_dir() -> Path:
    configured = os.getenv("AGENT_SKILLS_DIR")
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).resolve().parents[1] / "skills"


def load_enabled_skills(root: str | Path | None = None) -> list[AgentSkill]:
    return load_skills(root or default_skills_dir(), enabled_names=_enabled_skill_names())


def load_skills(root: str | Path, enabled_names: Iterable[str] | None = None) -> list[AgentSkill]:
    root_path = Path(root).expanduser()
    if not root_path.exists():
        return []

    enabled = _normalized_name_set(enabled_names)
    skills: list[AgentSkill] = []
    for skill_path in _skill_paths(root_path):
        skill = _parse_skill_file(skill_path)
        if enabled is not None and skill.name not in enabled:
            continue
        skills.append(skill)
    return skills


def format_skills_for_prompt(skills: Sequence[AgentSkill]) -> str:
    if not skills:
        return ""

    blocks = ["Loaded skills. Follow these instructions when they apply:"]
    for skill in skills:
        body = skill.content.strip()
        description = skill.description.strip()
        description_line = f"\nDescription: {description}" if description else ""
        blocks.append(f'<skill name="{skill.name}">{description_line}\n{body}\n</skill>')
    return "\n\n".join(blocks)


def allowed_tool_names_for_skills(skills: Sequence[AgentSkill]) -> set[str] | None:
    allowed: set[str] = set()
    for skill in skills:
        if skill.allowed_tools is None:
            continue
        allowed.update(tool_name for tool_name in skill.allowed_tools if tool_name)
    return allowed or None


def filter_tools_by_skill_allowed_tools(tools: Sequence[T], skills: Sequence[AgentSkill]) -> list[T]:
    allowed = allowed_tool_names_for_skills(skills)
    if allowed is None:
        return list(tools)
    return [tool for tool in tools if _tool_name(tool) in allowed]


def _enabled_skill_names() -> list[str] | None:
    value = os.getenv("AGENT_ENABLED_SKILLS", "")
    names = [part.strip() for part in value.split(",") if part.strip()]
    return names or None


def _normalized_name_set(names: Iterable[str] | None) -> set[str] | None:
    if names is None:
        return None
    normalized = {name.strip() for name in names if name.strip()}
    return normalized or set()


def _skill_paths(root: Path) -> list[Path]:
    paths: list[Path] = []
    root_skill = root / SKILL_FILE_NAME
    if root_skill.is_file():
        paths.append(root_skill)
    paths.extend(sorted(path for path in root.glob(f"*/{SKILL_FILE_NAME}") if path.is_file()))
    return paths


def _parse_skill_file(path: Path) -> AgentSkill:
    text = path.read_text(encoding="utf-8")
    metadata, body = _split_skill_markdown(text)
    return AgentSkill(
        name=str(metadata.get("name") or path.parent.name).strip(),
        description=str(metadata.get("description") or "").strip(),
        content=body.strip(),
        allowed_tools=_metadata_list(metadata.get("allowed_tools")),
        path=path,
    )


def _split_skill_markdown(text: str) -> tuple[dict[str, Any], str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text.strip()

    end_index = None
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_index = index
            break

    if end_index is None:
        return {}, text.strip()

    metadata = _parse_frontmatter(lines[1:end_index])
    body = "\n".join(lines[end_index + 1 :]).strip()
    return metadata, body


def _parse_frontmatter(lines: Sequence[str]) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    current_key: str | None = None

    for raw_line in lines:
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if raw_line[:1].isspace() and current_key and stripped.startswith("- "):
            value = _unquote(stripped[2:].strip())
            current_value = metadata.setdefault(current_key, [])
            if isinstance(current_value, list):
                current_value.append(value)
            continue

        if ":" not in raw_line:
            continue

        key, value = raw_line.split(":", 1)
        current_key = key.strip().replace("-", "_").lower()
        value = value.strip()
        if not value:
            metadata[current_key] = []
            continue
        metadata[current_key] = _parse_scalar_or_inline_list(value)

    return metadata


def _parse_scalar_or_inline_list(value: str) -> str | list[str]:
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [_unquote(part.strip()) for part in inner.split(",") if part.strip()]
    return _unquote(value)


def _metadata_list(value: Any) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, list):
        items = value
    else:
        items = str(value).split(",")

    normalized = [_unquote(str(item).strip()) for item in items]
    normalized = [item for item in normalized if item]
    return normalized or None


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _tool_name(tool: Any) -> str | None:
    if isinstance(tool, dict):
        value = tool.get("name")
    else:
        value = getattr(tool, "name", None)
    return str(value) if value else None
