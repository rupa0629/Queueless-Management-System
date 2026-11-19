import type { ServiceCode } from '../shared/types.ts';

export interface DomainFormConfig {
  code: ServiceCode;
  nameLabelKey: 'fullNameLabel' | 'nicknameOrNameLabel' | 'studentIdOrNameLabel';
  phoneRequired: boolean;
  showEmail: boolean;
  priorities: string[];
  detailLabelKey: 'reasonLabel' | 'serviceRequiredLabel' | 'applicationTypeLabel' | 'taskTypeLabel';
  detailOptions: string[];
  zeroFriction?: boolean;
}

export const SERVICE_DOMAIN_CONFIG: Record<ServiceCode, DomainFormConfig> = {
  HOPD: {
    code: 'HOPD',
    nameLabelKey: 'fullNameLabel',
    phoneRequired: true,
    showEmail: true,
    priorities: ['Standard', 'Senior Citizen / Differently Abled', 'Follow-up'],
    detailLabelKey: 'reasonLabel',
    detailOptions: [
      'General Physician Consultation',
      'Vitals & Checkup',
      'Lab Report Review',
      'Prescription Renewal',
    ],
  },
  BANK: {
    code: 'BANK',
    nameLabelKey: 'nicknameOrNameLabel',
    phoneRequired: true,
    showEmail: false,
    priorities: ['Standard', 'Senior Citizen'],
    detailLabelKey: 'serviceRequiredLabel',
    detailOptions: [
      'Cash Deposit / Withdrawal',
      'Demand Draft / Cheque',
      'Account / KYC Update',
      'Loan Inquiry',
    ],
  },
  PASS: {
    code: 'PASS',
    nameLabelKey: 'fullNameLabel',
    phoneRequired: true,
    showEmail: true,
    priorities: ['Standard', 'Tatkaal / Urgent', 'Senior Citizen'],
    detailLabelKey: 'applicationTypeLabel',
    detailOptions: [
      'Fresh Passport Verification',
      'Passport Renewal',
      'Biometric Capture',
      'Document Scrutiny',
    ],
  },
  LIB: {
    code: 'LIB',
    nameLabelKey: 'studentIdOrNameLabel',
    phoneRequired: false,
    showEmail: false,
    priorities: ['Standard'],
    detailLabelKey: 'taskTypeLabel',
    detailOptions: [
      'Book Check-Out & Returns',
      'New Membership',
      'Digital Archive Access',
    ],
    zeroFriction: true,
  },
};
