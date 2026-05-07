import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type InviteCandidate = {
  id?: string | null;
  name?: string | null;
  title?: string | null;
};

type InterviewInviteModalProps = {
  open: boolean;
  candidate: InviteCandidate | null;
  onClose: () => void;
  onSaved: () => void;
};

type InviteForm = {
  name: string;
  stage: string;
  position: string;
  schedule_time: string;
  interviewer: string;
  location_type: string;
};

const defaultDatetimeLocal = () =>
  new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const datetimeLocalToIso = (value: string): string | null => {
  const raw = value.trim();
  if (!raw) return null;

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
};

export default function InterviewInviteModal({ open, candidate, onClose, onSaved }: InterviewInviteModalProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<InviteForm>({
    name: '',
    stage: '技术初试（线上）',
    position: '',
    schedule_time: defaultDatetimeLocal(),
    interviewer: '',
    location_type: '线上会议（腾讯会议/Zoom）',
  });

  const canSubmit = useMemo(() => form.name.trim() && form.position.trim(), [form.name, form.position]);

  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setForm({
      name: (candidate?.name || '').trim(),
      stage: '技术初试（线上）',
      position: (candidate?.title || '').trim(),
      schedule_time: defaultDatetimeLocal(),
      interviewer: '',
      location_type: '线上会议（腾讯会议/Zoom）',
    });
  }, [open, candidate]);

  if (!open) return null;

  const handleSave = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);

    const { error } = await supabase.from('upcoming_interviews').insert([
      { ...form, schedule_time: datetimeLocalToIso(form.schedule_time), candidate_id: candidate?.id ?? null },
    ]);
    setSaving(false);

    if (error) {
      alert(`保存失败：${error.message}`);
      return;
    }

    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-surface-container-lowest shadow-2xl">
        <div className="flex items-center justify-between border-b border-outline-variant/15 bg-surface-container-low/50 px-6 py-4">
          <h3 className="font-semibold text-on-surface">邀约面试</h3>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">候选人姓名</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full rounded bg-surface-container-low px-3 py-2 text-sm outline-none transition-all focus:border-primary border border-transparent"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">岗位</label>
              <input
                type="text"
                value={form.position}
                onChange={(e) => setForm((prev) => ({ ...prev, position: e.target.value }))}
                className="w-full rounded bg-surface-container-low px-3 py-2 text-sm outline-none transition-all focus:border-primary border border-transparent"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">面试阶段</label>
            <input
              type="text"
              value={form.stage}
              onChange={(e) => setForm((prev) => ({ ...prev, stage: e.target.value }))}
              className="w-full rounded bg-surface-container-low px-3 py-2 text-sm outline-none transition-all focus:border-primary border border-transparent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">时间</label>
            <input
              type="datetime-local"
              value={form.schedule_time}
              onChange={(e) => setForm((prev) => ({ ...prev, schedule_time: e.target.value }))}
              className="w-full cursor-pointer rounded bg-surface-container-low px-3 py-2 text-sm outline-none transition-all focus:border-primary border border-transparent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">地点/方式</label>
            <input
              type="text"
              value={form.location_type}
              onChange={(e) => setForm((prev) => ({ ...prev, location_type: e.target.value }))}
              className="w-full rounded bg-surface-container-low px-3 py-2 text-sm outline-none transition-all focus:border-primary border border-transparent"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-outline-variant/15 bg-surface-container-low/30 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer px-4 py-2 text-sm font-medium text-on-surface-variant transition-colors hover:text-on-surface"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSubmit || saving}
            className="cursor-pointer rounded-md bg-primary px-5 py-2 text-sm font-medium text-white shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? '提交中...' : '提交并进入面试中控'}
          </button>
        </div>
      </div>
    </div>
  );
}

