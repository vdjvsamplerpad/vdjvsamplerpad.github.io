import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Trash2 } from 'lucide-react';

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'destructive' | 'default';
  icon?: React.ReactNode;
  onConfirm: () => void;
  theme?: 'light' | 'dark';
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  icon,
  onConfirm,
  theme = 'light'
}: ConfirmationDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} useHistory={false}>
      <DialogContent
        overlayClassName="z-[129]"
        className={`z-[130] sm:max-w-md backdrop-blur-md ${theme === 'dark' ? 'bg-gray-800/95 border-gray-600' : 'bg-white/95 border-gray-300'
        }`}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            {icon ? (
              <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                {icon}
              </div>
            ) : variant === 'destructive' ? (
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
            )}
            <DialogTitle className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>
              {title}
            </DialogTitle>
          </div>

          <DialogDescription className="sr-only">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
            {description}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            className="flex-1"
          >
            {cancelText}
          </Button>
          <Button
            variant={variant}
            onClick={handleConfirm}
            className={`flex-1 ${variant === 'destructive'
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : theme === 'dark'
                ? 'bg-indigo-500 hover:bg-indigo-400 text-white'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
          >
            {variant === 'destructive' && <Trash2 className="w-4 h-4 mr-2" />}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
