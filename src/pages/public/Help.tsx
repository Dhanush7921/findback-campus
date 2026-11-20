import { ChevronDown, Clock, Mail, MapPin, Phone } from 'lucide-react';
import { Card, PageHeader } from '../../components/ui';
import { useConfig } from '../../lib/config';
import { useI18n } from '../../lib/i18n';

const FAQ: [string, string][] = [
  ['How do I sign in?', 'Students and guests verify a mobile number with a one-time password. Student access also requires an exact match with the approved college registry. OTP confirms control of a phone; it is not proof of real-world identity.'],
  ['What if I used the old PIN system?', 'Complaints created before the V2 migration can still use the Legacy complaint access page. New complaints are linked to a verified-phone dashboard and do not receive a PIN.'],
  ['Can other people see my complaint?', 'No. There is no public complaint list. Your dashboard shows only complaints linked to your signed identity; authorised office staff can access records for operational work.'],
  ['Why can’t I see photos of found items?', 'To prevent false claims, found items are described in general terms. Staff compare your private ownership evidence against details only they can see.'],
  ['How do I collect my item?', 'After ownership approval, staff issue a short-lived, single-use receiver code. Confirm it from a verified-phone session; staff then physically check your ID and complete the release. A proxy also needs recorded owner authorisation.'],
  ['What should I write as ownership evidence?', 'Something only the owner would know: the lock-screen wallpaper, stickers, contents of a bag, a serial number, a scratch or engraving. Avoid sharing passwords.'],
  ['I found something. How do I report it?', 'Please hand it in at the lost & found office. Staff register it in FindBack so it can be matched with a complaint.'],
  ['How long is my data kept?', 'Personal details are automatically redacted a fixed period after a complaint is returned or closed. See the privacy policy.'],
  ['Can I use FindBack in Telugu?', 'Yes. Use the language switch at the top of the page.'],
];

export default function Help() {
  const { t } = useI18n();
  const { config } = useConfig();
  return (
    <div className="safe-x mx-auto max-w-5xl py-10 sm:py-14">
      <PageHeader eyebrow="FindBack" title={t('help.title')} />
      <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-3">
          {FAQ.map(([q, a]) => (
            <details key={q} className="card group p-0 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 font-semibold">
                {q}<ChevronDown className="h-5 w-5 shrink-0 text-ink-400 transition group-open:rotate-180" aria-hidden />
              </summary>
              <p className="px-5 pb-5 text-sm leading-relaxed text-ink-600">{a}</p>
            </details>
          ))}
        </div>
        <Card className="h-fit space-y-4 p-6">
          <h2 className="text-lg font-bold">{t('help.contact')}</h2>
          <p className="flex gap-3 text-sm text-ink-700"><MapPin className="h-5 w-5 shrink-0 text-teal-600" /> {config?.collectionOffice ?? 'Lost & Found Office'}</p>
          <p className="flex gap-3 text-sm text-ink-700"><Clock className="h-5 w-5 shrink-0 text-teal-600" /> {config?.collectionHours ?? '—'}</p>
          {config?.contactEmail && <a className="flex gap-3 text-sm font-medium text-teal-700 hover:underline" href={`mailto:${config.contactEmail}`}><Mail className="h-5 w-5 shrink-0" /> {config.contactEmail}</a>}
          {config?.contactPhone && <a className="flex gap-3 text-sm font-medium text-teal-700 hover:underline" href={`tel:${config.contactPhone}`}><Phone className="h-5 w-5 shrink-0" /> {config.contactPhone}</a>}
        </Card>
      </div>
    </div>
  );
}
