import React from 'react';
import { cn } from '../../utils/cn';

// Button
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}
export function Button({ variant = 'primary', size = 'md', className, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' && 'px-3 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-6 py-3 text-base',
        variant === 'primary' && 'bg-red-700 hover:bg-red-600 text-white',
        variant === 'secondary' && 'bg-slate-700 hover:bg-slate-600 text-slate-100',
        variant === 'danger' && 'bg-red-900 hover:bg-red-800 text-red-100',
        variant === 'ghost' && 'hover:bg-slate-700 text-slate-300 hover:text-white',
        variant === 'outline' && 'border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white hover:bg-slate-800',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// Card
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
}
export function Card({ selected, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'bg-slate-800 rounded-xl border transition-all',
        selected ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-700 hover:border-slate-500',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// Badge
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: string;
}
export function Badge({ color = 'slate', className, children, ...props }: BadgeProps) {
  const colors: Record<string, string> = {
    red: 'bg-red-900/50 text-red-300 border-red-700',
    amber: 'bg-amber-900/50 text-amber-300 border-amber-700',
    purple: 'bg-purple-900/50 text-purple-300 border-purple-700',
    blue: 'bg-blue-900/50 text-blue-300 border-blue-700',
    green: 'bg-green-900/50 text-green-300 border-green-700',
    orange: 'bg-orange-900/50 text-orange-300 border-orange-700',
    slate: 'bg-slate-700 text-slate-300 border-slate-600',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border',
        colors[color] ?? colors.slate,
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

// Input
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}
export function Input({ label, error, className, id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={inputId} className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</label>}
      <input
        id={inputId}
        className={cn(
          'bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-red-500 transition-colors',
          error && 'border-red-500',
          className,
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// Textarea
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}
export function Textarea({ label, className, id, ...props }: TextareaProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={inputId} className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</label>}
      <textarea
        id={inputId}
        className={cn(
          'bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-red-500 transition-colors resize-none',
          className,
        )}
        {...props}
      />
    </div>
  );
}

// Select
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}
export function Select({ label, options, className, id, ...props }: SelectProps) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={selectId} className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</label>}
      <select
        id={selectId}
        className={cn(
          'bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-red-500 transition-colors',
          className,
        )}
        {...props}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

// Toggle (checkbox styled)
interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}
export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className={cn('flex items-center gap-2 cursor-pointer', disabled && 'opacity-50 cursor-not-allowed')}>
      <div
        className={cn(
          'relative w-10 h-6 rounded-full transition-colors',
          checked ? 'bg-red-600' : 'bg-slate-600',
        )}
        onClick={() => !disabled && onChange(!checked)}
      >
        <div className={cn(
          'absolute top-1 w-4 h-4 bg-white rounded-full transition-transform',
          checked ? 'translate-x-5' : 'translate-x-1',
        )} />
      </div>
      {label && <span className="text-sm text-slate-300">{label}</span>}
    </label>
  );
}

// NumberStepper
interface NumberStepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  className?: string;
}
export function NumberStepper({ value, min = 0, max = 999, onChange, className }: NumberStepperProps) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center disabled:opacity-30 text-lg leading-none"
      >−</button>
      <span className="w-10 text-center font-bold text-white">{value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center disabled:opacity-30 text-lg leading-none"
      >+</button>
    </div>
  );
}

// Modal/Dialog
interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  wide?: boolean;
}
export function Dialog({ open, onClose, title, children, wide }: DialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className={cn('bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-thin', wide ? 'w-full max-w-2xl' : 'w-full max-w-lg')}
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
            <h2 className="text-lg font-bold text-white">{title}</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// Tabs
interface TabsProps {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}
export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 bg-slate-900 p-1 rounded-lg">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all',
            active === tab.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// Section header
export function SectionHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn('text-xs font-bold uppercase tracking-widest text-slate-400 mb-2', className)}>
      {children}
    </h3>
  );
}

// Stat box (for ability scores)
interface StatBoxProps {
  label: string;
  score: number;
  modifier: number;
  proficient?: boolean;
}
export function StatBox({ label, score, modifier }: StatBoxProps) {
  const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
  return (
    <div className="flex flex-col items-center bg-slate-900 border border-slate-700 rounded-xl py-3 px-2">
      <span className="text-xs uppercase tracking-widest text-slate-400 mb-1">{label}</span>
      <span className="text-3xl font-bold text-white">{modStr}</span>
      <div className="w-8 h-px bg-slate-600 my-1" />
      <span className="text-sm text-slate-400">{score}</span>
    </div>
  );
}
