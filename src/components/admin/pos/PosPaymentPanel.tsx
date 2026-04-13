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
      <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Step 3 · Checkout</p>
        <p className="text-2xl font-black text-stone-900">${(props.totalCents / 100).toFixed(2)}</p>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Customer</p>
        <div className="mt-2 grid gap-2">
          <label className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              value={props.customerName}
              onChange={(event) => props.onCustomerNameChange(event.target.value)}
              placeholder="Customer name (optional)"
              className="w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
            />
          </label>
          <label className="relative">
            <Receipt className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              value={props.customerEmail}
              onChange={(event) => props.onCustomerEmailChange(event.target.value)}
              placeholder={props.source === 'COMP' ? 'Guest email' : 'Receipt email'}
              className="w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
            />
          </label>
        </div>
      </div>

      {props.source === 'COMP' ? (
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={props.onToggleSendCompEmail}
            className="flex w-full items-center justify-between rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-left text-sm font-semibold text-stone-800"
          >
            <span>Send comp ticket email</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${props.sendCompEmail ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-600'}`}>
              {props.sendCompEmail ? 'On' : 'Off'}
            </span>
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Payment Method</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => props.onPaymentMethodChange('STRIPE')}
                className={[
                  'inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold transition',
                  props.paymentMethod === 'STRIPE' && !props.isComplimentaryDoorCheckout
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
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
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                ].join(' ')}
              >
                <Banknote className="h-4 w-4" /> Cash
              </button>
            </div>
            {props.isComplimentaryDoorCheckout && (
              <p className="mt-2 text-xs font-semibold text-emerald-700">Complimentary selection detected. Checkout will complete as $0 cash.</p>
            )}
          </div>

          {props.paymentMethod === 'STRIPE' && !props.isComplimentaryDoorCheckout && (
            <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Card Path</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => props.onStripeChargePathChange('TERMINAL')}
                  className={[
                    'inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold transition',
                    props.stripeChargePath === 'TERMINAL'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
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
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                  ].join(' ')}
                >
                  <Hash className="h-4 w-4" /> Manual
                </button>
              </div>

              {props.stripeChargePath === 'TERMINAL' ? (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-stone-500">Terminal device</p>
                    <button
                      type="button"
                      onClick={props.onRefreshTerminalDevices}
                      className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-bold text-stone-700 hover:bg-stone-100"
                    >
                      <RefreshCw className={`h-3 w-3 ${props.loadingTerminalDevices ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                  <select
                    value={props.selectedTerminalDeviceId}
                    onChange={(event) => props.onSelectedTerminalDeviceIdChange(event.target.value)}
                    className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
                  >
                    {!props.terminalDevices.length && <option value="">No active terminals</option>}
                    {props.terminalDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.name}{device.isBusy ? ' (Busy)' : ''}
                      </option>
                    ))}
                  </select>
                  {props.selectedTerminalBusy && (
                    <p className="text-xs font-semibold text-amber-700">Selected device is busy. New sale will queue.</p>
                  )}
                </div>
              ) : (
                <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  Manual card flow opens an embedded Stripe Payment Element in this POS screen.
                </p>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
            <button
              type="button"
              onClick={props.onToggleSendReceipt}
              className="flex w-full items-center justify-between rounded-xl border border-stone-300 bg-stone-50 px-3 py-2.5 text-left text-sm font-semibold text-stone-800"
            >
              <span>Send receipt email</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${props.sendReceipt ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-600'}`}>
                {props.sendReceipt ? 'On' : 'Off'}
              </span>
            </button>
            {props.sendReceipt && (
              <input
                value={props.receiptEmail}
                onChange={(event) => props.onReceiptEmailChange(event.target.value)}
                placeholder="customer@email.com"
                className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
              />
            )}

            {props.showStudentCode && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-600">Student in Show code</p>
                <input
                  value={props.studentCode}
                  onChange={(event) => props.onStudentCodeChange(event.target.value)}
                  placeholder="Student code"
                  className="mt-1.5 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
                />
              </div>
            )}

            <p className="mt-3 text-xs text-stone-500">{props.cashTonightLabel}</p>
          </div>
        </>
      )}

      {props.flowError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{props.flowError}</div>
      )}

      <button
        type="button"
        onClick={props.onSubmit}
        disabled={props.submitDisabled}
        className="sticky bottom-0 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-red-700 px-4 py-4 text-base font-black text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {props.submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {props.submitLabel} · ${(props.totalCents / 100).toFixed(2)}
      </button>
    </div>
  );
}
