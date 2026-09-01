import Link from "next/link";
import { signUp } from "@/lib/actions/auth";
import { AuthForm } from "@/components/AuthForm";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-xl">
        <div className="mb-6">
          <div className="text-xl font-bold tracking-tight">
            VAZOU<span className="text-accent">.</span>AI
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Descubra quanto dinheiro sua empresa está deixando escapar.
          </p>
        </div>

        <AuthForm
          action={signUp}
          submitLabel="Criar conta"
          fields={[
            { name: "full_name", label: "Seu nome", type: "text", placeholder: "Camila Ribeiro" },
            { name: "email", label: "E-mail", type: "email", placeholder: "voce@empresa.com" },
            {
              name: "password",
              label: "Senha",
              type: "password",
              placeholder: "mínimo 8 caracteres",
            },
          ]}
        />

        <p className="mt-6 text-center text-sm text-text-muted">
          Já tem conta?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
