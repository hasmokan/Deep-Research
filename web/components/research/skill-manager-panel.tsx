'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api';
import type { AgentSkill } from '@/lib/api/types';

interface SkillManagerPanelProps {
  open: boolean;
  onClose: () => void;
}

interface SkillDraft {
  name: string;
  description: string;
  content: string;
  allowedTools: string;
  enabled: boolean;
}

const EMPTY_DRAFT: SkillDraft = {
  name: '',
  description: '',
  content: '',
  allowedTools: 'web_search, ask_clarification',
  enabled: true,
};

const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/;

function skillToDraft(skill: AgentSkill): SkillDraft {
  return {
    name: skill.name,
    description: skill.description,
    content: skill.content,
    allowedTools: skill.allowed_tools.join(', '),
    enabled: skill.enabled,
  };
}

function parseAllowedTools(value: string) {
  return value
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);
}

function sortSkills(skills: AgentSkill[]) {
  return [...skills].sort((a, b) => a.name.localeCompare(b.name));
}

export function SkillManagerPanel({ open, onClose }: SkillManagerPanelProps) {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draft, setDraft] = useState<SkillDraft>(EMPTY_DRAFT);
  const [isLoading, setLoading] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.name === selectedName) ?? null,
    [selectedName, skills],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void apiClient.listAgentSkills()
      .then((loadedSkills) => {
        if (cancelled) {
          return;
        }
        const sorted = sortSkills(loadedSkills);
        setSkills(sorted);
        const nextSelected = sorted[0]?.name ?? null;
        setSelectedName(nextSelected);
        setDraft(nextSelected
          ? skillToDraft(sorted.find((skill) => skill.name === nextSelected) as AgentSkill)
          : EMPTY_DRAFT);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load skills');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (selectedSkill) {
      setDraft(skillToDraft(selectedSkill));
    }
  }, [selectedSkill]);

  if (!open) {
    return null;
  }

  const isNewSkill = selectedName === null;
  const normalizedName = draft.name.trim();

  const saveDraft = async () => {
    if (!SKILL_NAME_PATTERN.test(normalizedName)) {
      setError('Skill name can only use letters, numbers, and hyphens.');
      return;
    }

    if (!draft.content.trim()) {
      setError('Skill content is required.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = await apiClient.upsertAgentSkill(normalizedName, {
        description: draft.description.trim(),
        content: draft.content.trim(),
        allowed_tools: parseAllowedTools(draft.allowedTools),
        enabled: draft.enabled,
      });
      const nextSkills = sortSkills([
        ...skills.filter((skill) => skill.name !== saved.name),
        saved,
      ]);
      setSkills(nextSkills);
      setSelectedName(saved.name);
      setDraft(skillToDraft(saved));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save skill');
    } finally {
      setSaving(false);
    }
  };

  const toggleSkill = async (skill: AgentSkill) => {
    setError(null);
    try {
      const updated = await apiClient.setAgentSkillEnabled(skill.name, !skill.enabled);
      setSkills((currentSkills) => sortSkills(currentSkills.map((item) => (
        item.name === updated.name ? updated : item
      ))));
      if (selectedName === updated.name) {
        setDraft(skillToDraft(updated));
      }
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Unable to update skill');
    }
  };

  const deleteSelectedSkill = async () => {
    if (!selectedSkill || !window.confirm(`Delete skill "${selectedSkill.name}"?`)) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiClient.deleteAgentSkill(selectedSkill.name);
      const remaining = sortSkills(skills.filter((skill) => skill.name !== selectedSkill.name));
      setSkills(remaining);
      const nextSelected = remaining[0]?.name ?? null;
      setSelectedName(nextSelected);
      setDraft(nextSelected ? skillToDraft(remaining[0]) : EMPTY_DRAFT);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete skill');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-background/70 backdrop-blur-sm">
      <section className="flex h-full w-full max-w-[920px] flex-col border-l border-border bg-card shadow-2xl">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Skills</h2>
            <p className="text-xs text-muted-foreground">{skills.length} local skills</p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="rounded-full" onClick={onClose} aria-label="Close skills">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="min-h-0 border-b border-border md:border-b-0 md:border-r">
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Library</p>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="rounded-full"
                aria-label="New skill"
                onClick={() => {
                  setSelectedName(null);
                  setDraft(EMPTY_DRAFT);
                  setError(null);
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="max-h-[220px] overflow-y-auto p-2 md:max-h-none">
              {isLoading ? (
                <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading
                </div>
              ) : skills.length ? (
                <div className="grid gap-1">
                  {skills.map((skill) => (
                    <button
                      key={skill.name}
                      type="button"
                      onClick={() => {
                        setSelectedName(skill.name);
                        setError(null);
                      }}
                      className={`flex items-center justify-between gap-2 rounded-[8px] px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                        skill.name === selectedName ? 'bg-muted text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      <span className="min-w-0 truncate">{skill.name}</span>
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${skill.enabled ? 'bg-chart-5' : 'bg-muted-foreground/35'}`}
                        aria-label={skill.enabled ? 'Enabled' : 'Disabled'}
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="px-3 py-3 text-sm text-muted-foreground">No skills</p>
              )}
            </div>
          </aside>

          <form
            className="flex min-h-0 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void saveDraft();
            }}
          >
            <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[minmax(0,1fr)_160px]">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Name</span>
                <input
                  value={draft.name}
                  disabled={!isNewSkill}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  className="h-9 rounded-[8px] border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Status</span>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedSkill) {
                      void toggleSkill(selectedSkill);
                      return;
                    }
                    setDraft((current) => ({ ...current, enabled: !current.enabled }));
                  }}
                  className={`flex h-9 items-center justify-center gap-2 rounded-[8px] border px-3 text-sm transition-colors ${
                    draft.enabled
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {draft.enabled && <Check className="h-4 w-4" />}
                  {draft.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </label>

              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">Description</span>
                <input
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  className="h-9 rounded-[8px] border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                />
              </label>

              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">Allowed tools</span>
                <input
                  value={draft.allowedTools}
                  onChange={(event) => setDraft((current) => ({ ...current, allowedTools: event.target.value }))}
                  className="h-9 rounded-[8px] border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 p-4">
              <label className="grid h-full min-h-[360px] gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Instructions</span>
                <textarea
                  value={draft.content}
                  onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
                  className="min-h-0 flex-1 resize-none rounded-[8px] border border-input bg-background p-3 font-mono text-sm leading-6 outline-none focus:border-ring"
                />
              </label>
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-4">
              <div className="min-w-0 text-sm text-destructive">{error}</div>
              <div className="flex shrink-0 items-center gap-2">
                {selectedSkill && (
                  <Button type="button" variant="ghost" onClick={() => void deleteSelectedSkill()} disabled={isSaving}>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                )}
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
              </div>
            </footer>
          </form>
        </div>
      </section>
    </div>
  );
}
