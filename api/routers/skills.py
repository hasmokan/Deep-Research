"""Skill management API routes."""

from fastapi import APIRouter, Depends, HTTPException

from agents.skills import (
    AgentSkill,
    default_skills_dir,
    delete_skill,
    get_skill,
    load_skills,
    save_skill,
    set_skill_enabled,
    validate_skill_name,
)
from models.schemas import AgentSkillEnabledUpdate, AgentSkillResponse, AgentSkillUpsertRequest
from services.auth import AuthenticatedUser, get_current_user

router = APIRouter(prefix="/api/skills", tags=["skills"])


@router.get("", response_model=list[AgentSkillResponse])
async def list_agent_skills(
    _current_user: AuthenticatedUser = Depends(get_current_user),
):
    return [_skill_response(skill) for skill in load_skills(default_skills_dir(), include_disabled=True)]


@router.get("/{skill_name}", response_model=AgentSkillResponse)
async def get_agent_skill(
    skill_name: str,
    _current_user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        skill = get_skill(default_skills_dir(), skill_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if skill is None:
        raise HTTPException(status_code=404, detail=f"Skill {skill_name!r} not found")
    return _skill_response(skill)


@router.put("/{skill_name}", response_model=AgentSkillResponse)
async def upsert_agent_skill(
    skill_name: str,
    request: AgentSkillUpsertRequest,
    _current_user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        skill = save_skill(
            default_skills_dir(),
            skill_name,
            description=request.description,
            content=request.content,
            allowed_tools=request.allowed_tools,
            enabled=request.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _skill_response(skill)


@router.patch("/{skill_name}/enabled", response_model=AgentSkillResponse)
async def update_agent_skill_enabled(
    skill_name: str,
    request: AgentSkillEnabledUpdate,
    _current_user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        skill = set_skill_enabled(default_skills_dir(), skill_name, request.enabled)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _skill_response(skill)


@router.delete("/{skill_name}")
async def delete_agent_skill(
    skill_name: str,
    _current_user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        validate_skill_name(skill_name)
        deleted = delete_skill(default_skills_dir(), skill_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not deleted:
        raise HTTPException(status_code=404, detail=f"Skill {skill_name!r} not found")
    return {"deleted": True, "name": skill_name}


def _skill_response(skill: AgentSkill) -> AgentSkillResponse:
    return AgentSkillResponse(
        name=skill.name,
        description=skill.description,
        content=skill.content,
        allowed_tools=skill.allowed_tools or [],
        enabled=skill.enabled,
    )
