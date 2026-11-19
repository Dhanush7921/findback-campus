import { ChevronDown, Clock, Mail, MapPin, Phone } from 'lucide-react';
import { Card, PageHeader } from '../../components/ui';
import { useConfig } from '../../lib/config';
import { useI18n } from '../../lib/i18n';

const FAQ: [string, string][] = [
  ['Do I need an account?', 'No. Submit a complaint and you receive a Complaint ID and secret PIN. Those two together open your private complaint portal.'],
  ['I lost my PIN. What now?', 'PINs are stored only as secure one-way hashes, so nobody can look yours up. Visit the lost & found office with your college ID card. After verifying you, staff issue a new PIN and your old PIN stops working.'],
  ['Can other people see my complaint?', 'No. There is no public list of complaints. Only you (with ID + PIN) and authorised office staff can see it.'],
  ['Why can’t I see photos of found items?', 'To prevent false claims, found items are described in general terms. Staff compare your private ownership evidence against details only they can see.'],
  ['How do I collect my item?', 'Once staff verify your claim, your status changes to “Ready for collection” with instructions. Bring your college ID card. Staff check your identity and record the handover.'],
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
