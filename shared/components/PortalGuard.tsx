import React from 'react';
import { ShieldAlert, LogOut, ArrowLeft } from 'lucide-react';
import { Button, Card, CardContent } from './ui';

type Props = {
  actualRole: string;
  expectedRoleLabel: string;
  onLogout: () => void;
  onBack?: () => void;
  title?: string;
};

export function PortalGuard({
  actualRole,
  expectedRoleLabel,
  onLogout,
  onBack,
  title = 'Wrong Portal',
}: Props) {
  return (
    <div className="min-h-screen w-full bg-zinc-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <Card className="bg-white/5 border border-white/10 shadow-2xl">
          <CardContent className="p-8 text-center">
            <div className="mx-auto mb-5 w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center">
              <ShieldAlert size={26} className="text-lime-400" />
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
            <p className="text-zinc-300 mt-2">
              You’re logged in as <span className="font-extrabold">{actualRole}</span>. This area is for{' '}
              <span className="font-extrabold">{expectedRoleLabel}</span>.
            </p>

            <div className="mt-6 flex flex-col gap-3">
              <Button
                onClick={onLogout}
                size="lg"
                className="w-full bg-lime-400 text-black hover:bg-lime-300 focus-visible:ring-lime-300"
                leftIcon={<LogOut size={18} />}
              >
                Logout & Switch
              </Button>
              {onBack ? (
                <Button
                  onClick={onBack}
                  size="lg"
                  variant="secondary"
                  className="w-full bg-white/10 text-white border border-white/10 hover:bg-white/15"
                  leftIcon={<ArrowLeft size={18} />}
                >
                  Go Back
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
