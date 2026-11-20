import { BadgeCheck, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import { Button, Card, Field, Input, Notice, PageSkeleton } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { useConfig } from '../../lib/config';
import { phoneAuth } from '../../lib/firebase';
import { saveSession } from '../../lib/session';

export default function PhoneAccess() {
  const { mode: rawMode } = useParams();
  const mode = rawMode === 'guest' ? 'guest' : 'student';
  const { config, status } = useConfig();
  const nav = useNavigate();
  const verifier = useRef<RecaptchaVerifier | null>(null);
  const [phone, setPhone] = useState('+91');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [department, setDepartment] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { verifier.current?.clear(); }, []);
  if (status === 'loading') return <PageSkeleton />;

  async function sendOtp(e: FormEvent) {
    e.preventDefault();
    if (!config?.reporterAuth.enabled) return;
    setBusy(true); setError(null);
    try {
      const auth = phoneAuth(config);
      verifier.current?.clear();
      verifier.current = new RecaptchaVerifier(auth, 'firebase-recaptcha', { size: 'invisible' });
      setConfirmation(await signInWithPhoneNumber(auth, phone.replace(/[\s-]/g, ''), verifier.current));
    } catch (e) {
      verifier.current?.clear(); verifier.current = null;
      setError((e as Error).message.includes('too-many-requests') ? 'Too many OTP requests. Please wait before trying again.' : 'Could not send the OTP. Check the phone number and try again.');
    } finally { setBusy(false); }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    if (!confirmation) return;
    setBusy(true); setError(null);
    try {
      const credential = await confirmation.confirm(code.trim());
      const idToken = await credential.user.getIdToken(true);
      const r = await apiPost<{ token: string; expiresAt: number; role: string; name: string; phone: string; studentId: string; department: string; identityStatus: string }>('/api/v2/auth/session', { idToken, mode, name, studentId, department });
      saveSession('reporter', r.token, r.expiresAt, { role: r.role, name: r.name, phone: r.phone, studentId: r.studentId, department: r.department, identityStatus: r.identityStatus });
      nav('/dashboard', { replace: true });
    } catch (e) { setError((e as ApiError).message || 'OTP verification failed.'); }
    finally { setBusy(false); }
  }

  async function devLogin() {
    setBusy(true); setError(null);
    try {
      const r = await apiPost<{ token: string; expiresAt: number; role: string; name: string; phone: string; studentId: string; department: string; identityStatus: string }>('/api/v2/auth/dev-session', { role: mode });
      saveSession('reporter', r.token, r.expiresAt, { role: r.role, name: r.name, phone: r.phone, studentId: r.studentId, department: r.department, identityStatus: r.identityStatus });
      nav('/dashboard', { replace: true });
    } catch (e) { setError((e as ApiError).message); }
    finally { setBusy(false); }
  }

  const enabled = config?.reporterAuth.enabled;
  return (
    <div className="safe-x mx-auto grid max-w-5xl items-stretch gap-6 py-10 sm:py-16 lg:grid-cols-[.9fr_1.1fr]">
      <section className="brand-gradient relative overflow-hidden rounded-[2rem] p-8 text-white shadow-[var(--shadow-lift)] sm:p-10">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15"><Phone className="h-7 w-7" /></div>
        <p className="mt-8 text-xs font-bold uppercase tracking-[.18em] text-white/75">{mode === 'student' ? 'Student access' : 'Guest access'}</p>
        <h1 className="mt-2 text-3xl font-extrabold text-white sm:text-4xl">Verify your mobile number</h1>
        <p className="mt-4 max-w-md text-white/85">{mode === 'student' ? 'Your verified phone must match the approved college student registry.' : 'Phone verification lets you privately submit and track only your own guest complaint.'}</p>
        <div className="mt-8 space-y-3 text-sm text-white/90">
          <p className="flex gap-2"><ShieldCheck className="h-5 w-5 shrink-0" /> OTP proves control of the phone number, not real-world identity.</p>
          <p className="flex gap-2"><BadgeCheck className="h-5 w-5 shrink-0" /> Staff still verifies ownership before returning an item.</p>
        </div>
      </section>
      <Card className="p-6 sm:p-9">
        <div className="mb-6 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-teal-50 text-teal-700"><UserRound className="h-5 w-5" /></div><div><h2 className="text-xl font-extrabold">{confirmation ? 'Enter OTP' : mode === 'student' ? 'Student identity check' : 'Guest details'}</h2><p className="text-sm text-ink-500">Private, role-based access</p></div></div>
        {!enabled && <Notice tone="warn">Phone OTP is not configured on the production backend yet. Firebase/Identity Platform setup is required.</Notice>}
        {error && <Notice tone="error" className="mb-5">{error}</Notice>}
        {!confirmation ? (
          <form onSubmit={sendOtp} className="space-y-5">
            {mode === 'guest' && <Field label="Full name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />}</Field>}
            {mode === 'student' && <><Field label="Student ID" required>{(id) => <Input id={id} value={studentId} onChange={(e) => setStudentId(e.target.value.toUpperCase())} required />}</Field><Field label="Department" required>{(id) => <Input id={id} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. CSE" required />}</Field></>}
            <Field label="Mobile number" required hint="Use international format, for example +91 9876543210">{(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" required />}</Field>
            <div id="firebase-recaptcha" />
            <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!enabled || (mode === 'guest' ? name.trim().length < 2 : !studentId.trim() || !department.trim())}>Send OTP</Button>
            {config?.environment === 'development' && <Button type="button" variant="secondary" className="w-full" onClick={devLogin} loading={busy}>Development sign-in</Button>}
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-5">
            <Notice tone="info">A 6-digit code was sent to {phone}.</Notice>
            <Field label="OTP code" required>{(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="text-center font-mono text-2xl tracking-[.35em]" required />}</Field>
            <Button type="submit" className="w-full" size="lg" loading={busy} disabled={code.length !== 6}>Verify and continue</Button>
            <button type="button" className="w-full text-sm font-semibold text-teal-700" onClick={() => { setConfirmation(null); setCode(''); }}>Use another number</button>
          </form>
        )}
      </Card>
    </div>
  );
}
