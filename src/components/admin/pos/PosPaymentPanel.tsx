import { Banknote, CreditCard, Hash, RefreshCw, Receipt, Send, User } from 'lucide-react';
import type { PosTerminalDevice } from './types';

type PosPaymentPanelProps = {
  source: 'DOOR' | 'COMP';
  totalCents: number;
  customerName: string;
  customerEmail: string;
  sendCompEmail: boolean;
  onCustomerNameChange: (value: string) => void;
  onCustomerEmailChange: (value: string) => void;
  onToggleSendCompEmail: () => void;
  paymentMethod: 'STRIPE' | 'CASH';
  stripeChargePath: 'TERMINAL' | 'MANUAL';
  isComplimentaryDoorCheckout: boolean;
  onPaymentMethodChange: (value: 'STRIPE' | 'CASH') => void;
  onStripeChargePathChange: (value: 'TERMINAL' | 'MANUAL') => void;
  terminalDevices: PosTerminalDevice[];
  selectedTerminalDeviceId: string;
  selectedTerminalBusy: boolean;
  loadingTerminalDevices: boolean;
  onSelectedTerminalDeviceIdChange: (value: string) => void;
  onRefreshTerminalDevices: () => void;
  sendReceipt: boolean;
  receiptEmail: string;
  onToggleSendReceipt: () => void;
  onReceiptEmailChange: (value: string) => void;
  showStudentCode: boolean;
  studentCode: string;
  onStudentCodeChange: (value: string) => void;
  cashTonightLabel: string;
  flowError: string | null;
  submitDisabled: boolean;
  submitting: boolean;
  submitLabel: string;
  onSubmit: () => void;
};

export function PosPaymentPanel(props: PosPaymentPanelProps) {
  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Customer</p>
        <div className="mt-2 grid gap-2">
          <label className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={props.customerName}
              onChange={(event) => props.onCustomerNameChange(event.target.value)}
              placeholder="Customer name (optional)"
              className="w-full rounded-xl border border-slate-600 bg-slate-950 py-2.5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-400 focus:outline-none"
            />
          </label>
          <label className="relative">
            <Receipt className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={props.customerEmail}
              onChange={(event) => props.onCustomerEmailChange(event.target.value)}
              placeholder={props.source === 'COMP' ? 'Guest email' : 'Receipt email'}
              className="w-full rounded-xl border border-slate-600 bg-slate-950 py-2.5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-400 focus:outline-none"
            />
          </label>
        </div>
      </div>

      {props.source === 'COMP' ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3">
          <button
            type="button"
            onClick={props.onToggleSendCompEmail}
            className="flex w-full items-center justify-between rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-left text-sm font-semibold text-slate-100"
          >
            <span>Send comp ticket email</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${props.sendCompEmail ? 'bg-emerald-500/20 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}>
              {props.sendCompEmail ? 'On' : 'Off'}
            </span>
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Payment Method</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => props.onPaymentMethodChange('STRIPE')}
                className={[
                  'inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold transition',
                  props.paymentMethod === 'STRIPE' && !props.isComplimentaryDoorCheckout
                    ? 'border-rose-400 bg-rose-500/20 text-rose-100'
                    : 'border-slate-600 bg-slate-950 text-slate-200 hover:border-slate-500'
                ].join(' ')}
              >
                <CreditCard className="h-4 w-4" /> Card
              </button>
              <button
                type="button"
                onClick={() => props.onPaymentMethodChange('CASH')}
                className={[
                  'inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold transition',
                  props.paymentMethod === 'CASH' || props.isComplimentaryDoorCheckout
                    ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
                    : 'border-slate-600 bg-slate-950 text-slate-200 hover:border-slate-500'
                ].join(' ')}
              >
                <Banknote className="h-4 w-4" /> Cash
              </button>
            </div>
            {props.isComplimentaryDoorCheckout && (
              <p className="mt-2 text-xs font-semibold text-emerald-200">Complimentary selection detected. Checkout will complete as $0 cash.</p>
            )}
          </div>

          {props.paymentMethod === 'STRIPE' && !props.isComplimentaryDoorCheckout && (
            <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Card Path</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => props.onStripeChargePathChange('TERMINAL')}
                  className={[
                    'inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold transition',
                    props.stripeChargePath === 'TERMINAL'
                      ? 'border-rose-400 bg-rose-500/20 text-rose-100'
                      : 'border-slate-600 bg-slate-950 text-slate-200 hover:border-slate-500'
                  ].join(' ')}
                >
                  <CreditCard className="h-4 w-4" /> Terminal
                </button>
                <button
                  type="button"
                  onClick={() => props.onStripeChargePathChange('MANUAL')}
                  className={[
                    'inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold transition',
                    props.stripeChargePath === 'MANUAL'
                      ? 'border-rose-400 bg-rose-500/20 text-rose-100'
                      : 'border-slate-600 bg-slate-950 text-slate-200 hover:border-slate-500'
                  ].join(' ')}
                >
                  <Hash className="h-4 w-4" /> Manual
                </button>
              </div>

              {props.stripeChargePath === 'TERMINAL' ? (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-400">Terminal device</p>
                    <button
                      type="button"
                      onClick={props.onRefreshTerminalDevices}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2.5 py-1 text-xs font-bold text-slate-200 hover:border-slate-500"
                    >
                      <RefreshCw className={`h-3 w-3 ${props.loadingTerminalDevices ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                  <select
                    value={props.selectedTerminalDeviceId}
                    onChange={(event) => props.onSelectedTerminalDeviceIdChange(event.target.value)}
                    className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 focus:border-rose-400 focus:outline-none"
                  >
                    {!props.terminalDevices.length && <option value="">No active terminals</option>}
                    {props.terminalDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.name}{device.isBusy ? ' (Busy)' : ''}
                      </option>
                    ))}
                  </select>
                  {props.selectedTerminalBusy && (
                    <p className="text-xs font-semibold text-amber-200">Selected device is busy. New sale will queue.</p>
                  )}
                </div>
              ) : (
                <p className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  Manual card flow opens an embedded Stripe Payment Element in this POS screen.
                </p>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3">
            <button
              type="button"
              onClick={props.onToggleSendReceipt}
              className="flex w-full items-center justify-between rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-left text-sm font-semibold text-slate-100"
            >
              <span>Send receipt email</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${props.sendReceipt ? 'bg-emerald-500/20 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}>
                {props.sendReceipt ? 'On' : 'Off'}
              </span>
            </button>
            {props.sendReceipt && (
              <input
                value={props.receiptEmail}
                onChange={(event) => props.onReceiptEmailChange(event.target.value)}
                placeholder="customer@email.com"
                className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-400 focus:outline-none"
              />
            )}

            {props.showStudentCode && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Student in Show code</p>
                <input
                  value={props.studentCode}
                  onChange={(event) => props.onStudentCodeChange(event.target.value)}
                  placeholder="Student code"
                  className="mt-1.5 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-rose-400 focus:outline-none"
                />
              </div>
            )}

            <p className="mt-3 text-xs text-slate-400">{props.cashTonightLabel}</p>
          </div>
        </>
      )}

      {props.flowError && (
        <div className="rounded-2xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-100">{props.flowError}</div>
      )}

      <button
        type="button"
        onClick={props.onSubmit}
        disabled={props.submitDisabled}
        className="sticky bottom-0 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-4 text-base font-black text-white shadow-xl shadow-rose-900/40 transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {props.submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {props.submitLabel} · ${(props.totalCents / 100).toFixed(2)}
      </button>
    </div>
  );
}
