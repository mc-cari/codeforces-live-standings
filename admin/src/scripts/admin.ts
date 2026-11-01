type Settings = { mode: string; selectedContestIds: number[] };
type Contest = { id: number; name: string; phase: string; startTimeSeconds: number; collectionState: string; lastSuccessfulPoll: string; latestError: string };
type Status = { contests: Contest[]; discoveryUpdatedAt: string; discoveryStale: boolean; latestError: string; waiting: number; capacity: number };
const form = document.querySelector<HTMLFormElement>('#settings')!;
const controls = document.querySelector<HTMLFieldSetElement>('#controls')!;
const mode = document.querySelector<HTMLSelectElement>('#mode')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const message = document.querySelector<HTMLParagraphElement>('#message')!;
const tbody = document.querySelector<HTMLTableSectionElement>('#contests')!;
let selected = new Set<number>();
let saved = '';
let loaded = false;
let saving = false;
let refreshing = false;
const current = (): Settings => ({ mode: mode.value, selectedContestIds: [...selected].sort((a,b) => a-b) });
const key = (s: Settings) => JSON.stringify({ ...s, selectedContestIds: [...s.selectedContestIds].sort((a,b) => a-b) });
function say(text: string, kind = '') { message.textContent = text; message.dataset.kind = kind; }
function updateDirty() {
 const dirty = key(current()) !== saved;
 save.disabled = !loaded || saving || !dirty;
 document.querySelector('#selection-count')!.textContent = `${selected.size} selected`;
 return dirty;
}
function changed() { if (updateDirty()) say('Unsaved changes'); else say('All changes saved'); }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
 const response = await fetch(path, { ...init, headers: { 'Accept':'application/json', ...init?.headers } });
 if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Access denied. Sign in again, then retry.' : `Request failed (${response.status}). Try again.`);
 return response.json();
}
function date(value: string | number) {
 if (!value || (typeof value === 'string' && value.startsWith('0001'))) return 'Not yet';
 return new Date(typeof value === 'number' ? value*1000 : value).toLocaleString();
}
function cell(parent: HTMLElement, text: string, tag = 'td') { const el = document.createElement(tag); el.textContent = text; parent.append(el); return el; }
function render(status: Status) {
 const focusedId = document.activeElement instanceof HTMLInputElement ? document.activeElement.dataset.contest : undefined;
 document.querySelector('#discovery')!.textContent = `Discovery ${status.discoveryStale ? 'stale' : 'up to date'} · Last success: ${date(status.discoveryUpdatedAt)}`;
 const active = status.contests.filter(c => c.collectionState === 'live' || c.collectionState === 'stale').length;
 document.querySelector('#capacity')!.textContent = `${active} / ${status.capacity} collection slots in use${status.waiting ? ` · ${status.waiting} waiting for capacity. Existing sessions will finish first.` : ''}`;
 document.querySelector('#discovery-error')!.textContent = status.latestError;
 tbody.replaceChildren();
 const rows = [...status.contests];
 for (const id of selected) if (!rows.some(c => c.id === id)) rows.push({id,name:`Contest ${id}`,phase:'Not in current discovery',startTimeSeconds:0,collectionState:'idle',lastSuccessfulPoll:'',latestError:''});
 for (const contest of rows) {
  const row = document.createElement('tr');
  const selectCell = cell(row,'');
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(contest.id); checkbox.dataset.contest = String(contest.id); checkbox.setAttribute('aria-label',`Collect ${contest.name}`);
  checkbox.addEventListener('change',() => { if (checkbox.checked) selected.add(contest.id); else selected.delete(contest.id); changed(); }); selectCell.append(checkbox);
  cell(row,contest.name); const start = cell(row,date(contest.startTimeSeconds)); cell(start,contest.phase,'small');
  const state = cell(row,contest.collectionState === 'idle' ? 'Not collecting' : contest.collectionState); state.className = contest.collectionState;
  cell(state,`Last successful poll: ${date(contest.lastSuccessfulPoll)}`,'small');
  if (contest.latestError) { const error = cell(state,contest.latestError,'small'); error.className = 'error'; }
  tbody.append(row);
 }
 if (!rows.length) { const row = document.createElement('tr'); const empty = cell(row,'No upcoming or running contests. Discovery will check again while collection is enabled.'); empty.setAttribute('colspan','4'); tbody.append(row); }
 if (focusedId) tbody.querySelector<HTMLInputElement>(`input[data-contest="${focusedId}"]`)?.focus({preventScroll:true});
 updateDirty();
}
async function refresh() {
 if (refreshing) return;
 refreshing = true;
 try {
  if (!loaded) { const settings = await request<Settings>('/api/settings'); mode.value = settings.mode; selected = new Set(settings.selectedContestIds); saved = key(settings); loaded = true; controls.disabled = false; say('All changes saved'); }
  render(await request<Status>('/api/contests'));
 } catch (error) { document.querySelector('#discovery-error')!.textContent = `${(error as Error).message} Use Refresh status to retry.`; if (!loaded) say('Settings could not be loaded. Refresh to retry.','error'); }
 finally { refreshing = false; }
}
mode.addEventListener('change',changed);
form.addEventListener('submit',async event => {
 event.preventDefault(); if (!loaded || saving) return;
 saving = true; controls.disabled = true; updateDirty(); save.textContent = 'Saving…'; say('Saving settings…');
 try { const result = await request<Settings>('/api/settings',{ method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(current()) }); saved = key(result); say('Settings saved. Existing sessions continue to completion.','success'); }
 catch (error) { say(`${(error as Error).message} Your changes are still here.`,'error'); }
 finally { saving = false; controls.disabled = false; save.textContent = 'Save settings'; updateDirty(); }
 void refresh();
});
document.querySelector('#refresh')!.addEventListener('click',() => { void refresh(); });
window.addEventListener('beforeunload',event => { if (loaded && key(current()) !== saved) event.preventDefault(); });
void refresh(); setInterval(() => { void refresh(); },15000);
