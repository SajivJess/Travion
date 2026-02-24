import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Users, Copy, Check, Loader, UserCheck } from 'lucide-react';

const BACKEND_URL = 'http://localhost:3000';

export interface TripMember {
  id: string;
  tripJobId: string;
  userId: string;
  role: 'owner' | 'member';
  status: 'invited' | 'joined';
  displayName?: string;
  email?: string;
  joinedAt?: string;
}

interface ActiveInvite {
  token: string;
  code: string;
  link: string;
  expiresAt: string;
}

interface Props {
  tripJobId: string;
  maxTravelers: number;
  token?: string;
  userId?: string;
  ownerDisplayName?: string;
}

function timeUntil(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const InvitePanel: React.FC<Props> = ({ tripJobId, maxTravelers, token, userId, ownerDisplayName }) => {
  const [members, setMembers] = useState<TripMember[]>([]);
  const [invite, setInvite] = useState<ActiveInvite | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, inviteRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/team/members/${tripJobId}`, { headers: headers() }),
        fetch(`${BACKEND_URL}/api/team/invite/${tripJobId}`, { headers: headers() }),
      ]);
      if (membersRes.ok) {
        const data = await membersRes.json();
        if (Array.isArray(data)) setMembers(data);
      }
      if (inviteRes.ok) {
        const data = await inviteRes.json();
        if (data?.code) setInvite(data);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [tripJobId, headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const generateInvite = async () => {
    if (!userId) return;
    setGenerating(true);
    setGenerateError('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/team/invite/generate`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          tripJobId,
          ownerId: userId,
          maxTravelers,
          ownerDisplayName: ownerDisplayName || 'Owner',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setInvite(data);
        await fetchData();
      } else {
        setGenerateError(data?.message || `Error ${res.status} — check that trip tables exist in Supabase.`);
      }
    } catch (e: any) {
      setGenerateError(e?.message || 'Network error — backend may be down.');
    }
    setGenerating(false);
  };

  const copyCode = async () => {
    if (!invite) return;
    await navigator.clipboard.writeText(invite.code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const copyLink = async () => {
    if (!invite) return;
    await navigator.clipboard.writeText(invite.link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const joined = members.filter((m) => m.status === 'joined').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-3 glass-card rounded-xl">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-brand-primary" />
          <span className="text-sm font-semibold text-white">Trip Team</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${joined >= maxTravelers ? 'text-emerald-400' : 'text-brand-primary'}`}>
            {joined}/{maxTravelers}
          </span>
          <span className="text-xs text-gray-500">joined</span>
        </div>
      </div>

      {joined >= maxTravelers && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5 text-xs text-emerald-400 flex items-center gap-2">
          <UserCheck size={13} /> Trip is full
        </div>
      )}

      {joined < maxTravelers && (
        <div className="glass-card rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-300 mb-1">Invite Someone</p>
          {invite ? (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-center">
                  <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-widest">Team Code</p>
                  <p className="text-2xl font-mono font-bold text-white tracking-[0.3em]">{invite.code}</p>
                </div>
                <button onClick={copyCode} className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl bg-brand-primary/10 hover:bg-brand-primary/20 border border-brand-primary/20 text-brand-primary transition-all">
                  {codeCopied ? <Check size={16} /> : <Copy size={16} />}
                  <span className="text-[10px]">{codeCopied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input readOnly value={invite.link} className="flex-1 text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-gray-400 focus:outline-none truncate" />
                <button onClick={copyLink} className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all">
                  {linkCopied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
              <p className="text-[10px] text-gray-600 flex items-center gap-1">
                Expires in {timeUntil(invite.expiresAt)}
                <span className="mx-2 text-gray-700">·</span>
                <button onClick={generateInvite} disabled={generating} className="text-brand-primary/70 hover:text-brand-primary transition-colors">Regenerate</button>
              </p>
            </>
          ) : (
            <>
              <button onClick={generateInvite} disabled={generating || !userId} className="w-full flex items-center justify-center gap-2 gradient-primary text-white font-semibold py-2.5 rounded-xl disabled:opacity-40 transition-all text-sm">
                {generating ? <Loader size={14} className="animate-spin" /> : <Users size={14} />}
                {generating ? 'Generating…' : 'Generate Invite'}
              </button>
              {generateError && (
                <p className="text-xs text-red-400 mt-1.5 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{generateError}</p>
              )}
            </>
          )}
        </div>
      )}

      <JoinCodeInput tripJobId={tripJobId} token={token} userId={userId} onJoined={fetchData} />

      {loading ? (
        <div className="flex justify-center py-4"><Loader size={16} className="animate-spin text-gray-500" /></div>
      ) : members.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-widest px-1">Members</p>
          {members.map((m) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 p-3 glass-card rounded-xl">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${m.role === 'owner' ? 'bg-brand-primary/20 text-brand-primary' : 'bg-purple-500/20 text-purple-400'}`}>
                {(m.displayName || m.email || 'M')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{m.displayName || m.email || `User ${m.userId.slice(0, 6)}`}</p>
                <p className="text-xs text-gray-500 capitalize">{m.role}</p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${m.status === 'joined' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                {m.status === 'joined' ? '✓ Joined' : 'Invited'}
              </span>
            </motion.div>
          ))}
        </div>
      ) : null}

      <div className="glass-card rounded-xl p-4 space-y-2">
        <p className="text-xs font-semibold text-gray-400">Member Permissions</p>
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          {[
            { icon: '✔', text: 'Give quick review', ok: true },
            { icon: '✔', text: 'Suggest changes', ok: true },
            { icon: '✔', text: 'Report issues', ok: true },
            { icon: '✔', text: 'Flag activities', ok: true },
            { icon: '❌', text: 'Replan trip', ok: false },
            { icon: '❌', text: 'Change budget', ok: false },
          ].map((item, i) => (
            <div key={i} className={`flex items-center gap-1.5 ${item.ok ? 'text-emerald-400/80' : 'text-gray-600'}`}>
              <span>{item.icon}</span><span>{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface JoinProps { tripJobId: string; token?: string; userId?: string; onJoined: () => void; }

const JoinCodeInput: React.FC<JoinProps> = ({ token, userId, onJoined }) => {
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  const submit = async () => {
    if (!code.trim() || !userId) return;
    setJoining(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/team/invite/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ tokenOrCode: code.trim().toUpperCase(), userId }),
      });
      if (res.ok) { setResult('success'); onJoined(); }
      else setResult('error');
    } catch { setResult('error'); }
    setJoining(false);
  };

  if (result === 'success') return (
    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5 text-xs text-emerald-400 flex items-center gap-2">
      <Check size={12} /> Joined successfully!
    </div>
  );

  return (
    <div className="glass-card rounded-xl p-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Have a code?</p>
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} placeholder="e.g. DEL6X9"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono font-bold text-white tracking-widest uppercase placeholder-gray-600 focus:outline-none focus:border-brand-primary/50" />
        <button onClick={submit} disabled={!code.trim() || joining}
          className="flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-lg gradient-primary text-white disabled:opacity-40 transition-all">
          {joining ? <Loader size={12} className="animate-spin" /> : 'Join'}
        </button>
      </div>
      {result === 'error' && <p className="text-xs text-red-400 mt-1.5">Invalid code or invite expired.</p>}
    </div>
  );
};

export default InvitePanel;
