import type { BusinessProfile } from '@frontdesk/shared';

/**
 * A fictional physiotherapy clinic. Every name, address, number and price here is made up. Used by the public demo
 * and by the evaluation set (evals/), so the evals test the same knowledge the demo answers from.
 */
export const DEMO_BUSINESS: BusinessProfile = {
  name: 'Riverside Physio (demo)',
  address: '12 Example Lane, Exampleton, EX1 2PL',
  email: 'hello@riverside-physio.example',
  phone: '01632 960 123',
  bookingUrl: 'https://booking.riverside-physio.example',
  openingHours: {
    mon: { closed: false, open: '08:00', close: '19:00' },
    tue: { closed: false, open: '08:00', close: '19:00' },
    wed: { closed: false, open: '08:00', close: '19:00' },
    thu: { closed: false, open: '08:00', close: '20:00' },
    fri: { closed: false, open: '08:00', close: '17:00' },
    sat: { closed: false, open: '09:00', close: '13:00' },
    sun: { closed: true, open: '09:00', close: '13:00' },
    notes: 'Closed on bank holidays.',
  },
};

export const DEMO_RULES = [
  'Always mention that the first appointment includes a full assessment.',
  'If someone asks about a specific injury, suggest booking an assessment rather than describing treatment.',
].join('\n');

export const DEMO_GREETING = 'Hello! I’m the Riverside Physio assistant. Ask me about treatments, prices or opening hours.';

export const DEMO_FAQS: { question: string; answer: string }[] = [
  { question: 'Is there parking?', answer: 'Yes. There is free parking for 12 cars behind the clinic, including 2 disabled bays. Enter from Mill Road.' },
  {
    question: 'Do you accept health insurance?',
    answer: 'Yes. We are registered with Bupa, AXA Health, Aviva and Vitality. Please bring your membership number and authorisation code.',
  },
  {
    question: 'What is your cancellation policy?',
    answer: 'Please give at least 24 hours’ notice to cancel or move an appointment. Late cancellations and missed appointments are charged in full.',
  },
  { question: 'Is the clinic wheelchair accessible?', answer: 'Yes. The clinic is on the ground floor with step-free access and an accessible toilet.' },
  { question: 'Do I need a GP referral?', answer: 'No, you don’t need a referral. You can book directly with us.' },
  { question: 'What should I wear to my appointment?', answer: 'Wear loose, comfortable clothing, such as shorts or leggings, so we can see and move the area being treated.' },
];

export const DEMO_PAGES: { title: string; content: string }[] = [
  {
    title: 'Prices',
    content: [
      'Initial assessment and treatment (60 minutes): £65.',
      'Follow-up treatment (45 minutes): £50.',
      'Sports massage (45 minutes): £55.',
      'Sports massage (60 minutes): £70.',
      'Acupuncture as part of a treatment session: no extra charge.',
      'We take card and contactless payments. We do not take cash.',
    ].join('\n'),
  },
  {
    title: 'Treatments and services',
    content: [
      'Riverside Physio offers physiotherapy for back and neck pain, sports injuries, joint pain, and rehabilitation after surgery.',
      'We also offer sports massage, acupuncture (dry needling) and Pilates-based rehabilitation classes.',
      'Pilates rehabilitation classes run on Tuesday and Thursday evenings at 18:30, with up to 6 people per class, and cost £15 per class.',
      'Home visits are available within 5 miles of the clinic for an extra £20.',
      'We treat adults and children aged 12 and over.',
    ].join('\n'),
  },
  {
    title: 'Our team',
    content: [
      'The clinic has three chartered physiotherapists, all registered with the Health and Care Professions Council (HCPC), and one sports massage therapist.',
      'All of our physiotherapists can see new patients.',
    ].join('\n'),
  },
  {
    title: 'Your first appointment',
    content: [
      'Your first appointment lasts 60 minutes and includes a full assessment of your problem, your medical history and how it affects your daily life.',
      'Most people also get their first treatment and a home exercise plan in the same session.',
      'Please arrive 5 minutes early to fill in a short form.',
    ].join('\n'),
  },
];
