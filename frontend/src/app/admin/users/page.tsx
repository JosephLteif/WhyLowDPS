'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../components/AuthContext';
import { createHostedUser, HostedUser, listHostedUsers, updateHostedUser } from '../../lib/api';

export default function UsersAdminPage() {
  const { user, loading } = useAuth();
  const [users, setUsers] = useState<HostedUser[]>([]);
  const [battletag, setBattletag] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setUsers(await listHostedUsers());
      setError('');
    } catch (requestError: any) {
      setError(requestError?.message || 'Could not load users.');
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') void refresh();
  }, [refresh, user]);

  if (loading) return null;
  if (user?.role !== 'admin') {
    return <main className="mx-auto max-w-3xl p-8 text-zinc-200">Admin access required.</main>;
  }

  const addUser = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await createHostedUser(battletag.trim(), 'member');
      setBattletag('');
      await refresh();
    } catch (requestError: any) {
      setError(requestError?.message || 'Could not add user.');
    }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6 text-zinc-100">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Allow Battle.net accounts to use this private instance.
        </p>
      </div>

      <form onSubmit={addUser} className="flex gap-2">
        <input
          value={battletag}
          onChange={(event) => setBattletag(event.target.value)}
          placeholder="BattleTag#1234"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-900 px-3 py-2"
          required
        />
        <button className="rounded-md bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500">
          Add user
        </button>
      </form>

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}

      <div className="divide-y divide-white/10 rounded-lg border border-white/10 bg-zinc-900/60">
        {users.map((entry) => (
          <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-medium">{entry.battletag}</div>
              <div className="text-xs text-zinc-400">
                {entry.provider_subject ? 'Active account' : 'Pending first login'}
                {entry.last_login_at
                  ? ` · Last login ${new Date(entry.last_login_at).toLocaleString()}`
                  : ''}
              </div>
            </div>
            {entry.id === user.id ? (
              <div className="flex items-center gap-2 text-xs text-emerald-300">
                <span className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1.5">
                  Current account protected
                </span>
                <span className="text-zinc-500">
                  {entry.role === 'admin' ? 'Administrator' : 'Member'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  value={entry.role}
                  onChange={async (event) => {
                    await updateHostedUser(entry.id, {
                      role: event.target.value as 'admin' | 'member',
                    });
                    await refresh();
                  }}
                  className="rounded-md border border-white/10 bg-zinc-950 px-2 py-1.5 text-sm"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={async () => {
                    await updateHostedUser(entry.id, {
                      enabled: !entry.enabled,
                      revoke_sessions: entry.enabled,
                    });
                    await refresh();
                  }}
                  className="rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
                >
                  {entry.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={async () => {
                    await updateHostedUser(entry.id, { revoke_sessions: true });
                    await refresh();
                  }}
                  className="rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
