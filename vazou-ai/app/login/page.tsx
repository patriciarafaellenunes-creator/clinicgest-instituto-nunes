import Link from "next/link";
import { signIn } from "@/lib/actions/auth";
import { AuthForm } from "@/components/AuthForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-xl">
        <div className="mb-6">
          <div className="text-xl font-bold tracking-tight">
            VAZOU<span className="text-accent">.</span>AI
          </div>
          <p className="mt-1 text-sm text-text-muted">Entrar na sua conta</p>
        </div>

        <AuthForm
          action={signIn}
          submitLabel="Entrar"
          fields={[
            { name: "email", label: "E-mail", type: "email", placeholder: "voce@empresa.com" },
            { name: "password", label: "Senha", type: "password", placeholder: "••••••••" },
          ]}
        />

        <p className="mt-6 text-center text-sm text-text-muted">
          Ainda não tem conta?{" "}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            Criar conta
          </Link>
        </p>
      </div>
    </div>
  );
}
