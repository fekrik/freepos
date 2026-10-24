import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, session, type Session } from '../api';
import { TimeClockModal } from '../components/TimeClockModal';

const LANE_KEY = 'freshpos.lane';
interface LaneConfig { tenant: string; storeId: string; storeName: string }

export function LaneLogin() {
  const nav = useNavigate();
  const [lane, setLane] = useState<LaneConfig | null>(() => JSON.parse(localStorage.getItem(LANE_KEY) ?? 'null'));
  const [tenant, setTenant] = useState('demo');
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [step, setStep] = useState<'emp' | 'pin'>('emp');
  const [emp, setEmp] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showTimeClock, setShowTimeClock] = useState(false);

  const value = step === 'emp' ? emp : pin;
  const setValue = step === 'emp' ? setEmp : setPin;

  async function loadStores() {
    setErr('');
    try { setStores((await api<{ stores: { id: string; name: string }[] }>(`/tenants/${tenant}/stores`)).stores); }
    catch (e) { setErr((e as Error).message); }
  }

  async function submit() {
    if (step === 'emp') { if (emp) setStep('pin'); return; }
    if (!lane) return;
    setBusy(true); setErr('');
    try {
      const s = await api<Session>('/auth/pin', { method: 'POST', json: { tenant: lane.tenant, storeId: lane.storeId, employeeNo: emp, pin } });
      session.set(s, 'lane');
      nav('/lane');
    } catch (e) {
      setErr((e as Error).message); setPin(''); setStep('emp'); setEmp('');
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (lane) {
      api<{ stores: { id: string; name: string }[] }>(`/tenants/${lane.tenant}/stores`)
        .then((res) => {
          const match = res.stores.find((s) => s.id === lane.storeId);
          if (!match) {
            localStorage.removeItem(LANE_KEY);
            setLane(null);
            setStores(res.stores);
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!lane) return;
      if (/^\d$/.test(e.key)) setValue((v) => (v + e.key).slice(0, 8));
      else if (e.key === 'Backspace') setValue((v) => v.slice(0, -1));
      else if (e.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!lane) {
    return (
      <main className="center-screen">
        <section className="glass pin-card animate-in">
          <div className="logo"><div className="logo-mark">F</div>FreshPOS</div>
          <h1 style={{ fontSize: '1.4rem' }}>Set up this lane</h1>
          <label>Company ID<input id="tenant-input" className="input" value={tenant} onChange={(e) => setTenant(e.target.value)} /></label>
          <button id="load-stores" className="btn" onClick={loadStores}>Find stores</button>
          {stores.map((s) => (
            <button key={s.id} className="btn btn-primary" onClick={() => {
              const cfg = { tenant, storeId: s.id, storeName: s.name };
              localStorage.setItem(LANE_KEY, JSON.stringify(cfg)); setLane(cfg);
            }}>{s.name}</button>
          ))}
          <div className="error">{err}</div>
        </section>
      </main>
    );
  }

  const press = (k: string) => {
    if (k === '⌫') setValue((v) => v.slice(0, -1));
    else if (k === '✓') submit();
    else setValue((v) => (v + k).slice(0, 8));
  };

  return (
    <main className="center-screen">
      <section className="glass pin-card animate-in">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="logo"><div className="logo-mark">F</div>FreshPOS</div>
          <span className="muted" style={{ fontSize: '.85rem' }}>{lane.storeName}</span>
        </div>
        <h1 style={{ fontSize: '1.3rem', textAlign: 'center' }}>{step === 'emp' ? 'Employee number' : 'Enter PIN'}</h1>
        {step === 'emp'
          ? <div className="mono" style={{ textAlign: 'center', fontSize: '1.8rem', height: 40 }}>{emp || <span className="muted">—</span>}</div>
          : <div className="pin-dots">{Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <div key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''}`} />)}</div>}
        <div className="pin-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => (
            <button key={k} id={`pin-${k}`} className={`btn ${k === '✓' ? 'btn-primary' : ''}`} disabled={busy} onClick={() => press(k)}>{k}</button>
          ))}
        </div>
        <div className="error" style={{ textAlign: 'center' }}>{err}</div>
        <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="btn" style={{ fontSize: '.8rem' }} onClick={() => { localStorage.removeItem(LANE_KEY); setLane(null); }}>Change store</button>
          <button id="login-time-clock-btn" className="btn btn-primary" style={{ fontSize: '.8rem' }} onClick={() => setShowTimeClock(true)}>⏱️ Time Clock</button>
        </div>
      </section>

      {showTimeClock && (
        <TimeClockModal
          tenant={lane?.tenant ?? tenant ?? 'demo'}
          storeId={lane?.storeId ?? stores[0]?.id ?? ''}
          defaultEmployeeNo={emp}
          onClose={() => setShowTimeClock(false)}
          onSuccess={(msg) => setErr(msg)}
        />
      )}
    </main>
  );
}
