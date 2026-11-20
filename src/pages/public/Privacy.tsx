import { Card, PageHeader } from '../../components/ui';
import { useI18n } from '../../lib/i18n';

export default function Privacy() {
  const { t } = useI18n();
  return (
    <div className="safe-x mx-auto max-w-3xl py-10 sm:py-14">
      <PageHeader eyebrow="FindBack" title={t('privacy.title')} lead="Effective from launch. This notice explains what FindBack collects, why, who can see it and how long it is kept." />
      <Card className="prose-fb p-6 sm:p-9">
        <h2>What we collect</h2>
        <ul>
          <li>Your verified phone identity, name and—when using Student access—student ID and department from the approved college registry.</li>
          <li>Details of the lost item, where and when it was lost, an optional photo and private ownership evidence.</li>
          <li>Technical records needed for security: request timestamps, a truncated one-way hash of your network address, and failed-access counters. We do not use tracking cookies or analytics scripts.</li>
        </ul>
        <h2>Why we collect it</h2>
        <p>Only to match lost items with found items, verify ownership before releasing property, contact you about your complaint, and protect the service from abuse.</p>
        <h2>Who can see it</h2>
        <ul>
          <li>You, through the private dashboard linked to your verified-phone identity.</li>
          <li>Authorised lost & found staff, who sign in with institution-approved Google accounts. Staff actions are recorded in an activity log.</li>
          <li>No other student can see your complaint. There is no public list or search of complaints.</li>
        </ul>
        <h2>How it is protected</h2>
        <ul>
          <li>All traffic uses HTTPS. Records are stored in a private institutional Google Sheet; photos in a private Google Drive folder. Neither is published or shared publicly.</li>
          <li>Firebase/Identity Platform verifies phone OTP tokens; the API validates the signed token before issuing a short-lived FindBack session.</li>
          <li>Receiver collection codes are short-lived and single-use. Only a keyed hash is stored; the plaintext code cannot be recovered.</li>
          <li>Found-item photos and private details are never shown to students, to prevent false claims.</li>
        </ul>
        <h2>Retention</h2>
        <p>When a complaint is returned or closed, personal details (name, ID, contact, ownership evidence, photo) are automatically redacted after the retention period set by the office (default 180 days). Anonymous counts are kept for reporting. Unclaimed found items are reviewed after the configured period and may be donated or disposed of per institutional policy.</p>
        <h2>Your choices</h2>
        <p>You can close your own open complaint from your dashboard. To request a correction or early deletion, contact the lost & found office.</p>
        <h2>Usage guidelines</h2>
        <ul>
          <li>Submit only genuine complaints for items you own. False claims may be referred to the institution’s disciplinary process.</li>
          <li>Never share an OTP or receiver code outside the active collection process. Staff will not ask for your phone OTP.</li>
          <li>Do not include passwords, bank details or other sensitive secrets in any field.</li>
          <li>Automated or bulk submissions are blocked.</li>
        </ul>
      </Card>
    </div>
  );
}
