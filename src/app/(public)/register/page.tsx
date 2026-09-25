import type { Metadata } from 'next';
import Link from 'next/link';

import { RegisterForm } from '@/features/auth/components/register-form';
import styles from '@/features/auth/components/auth-form.module.css';

export const metadata: Metadata = {
    title: 'Criar conta',
};

export default function RegisterPage() {
    return (
        <main className={styles.page}>
            <section className={styles.card} aria-labelledby="register-title">
                <h1 id="register-title" className={styles.title}>
                    Criar conta
                </h1>

                <RegisterForm />

                <p className={styles.footer}>
                    Já tem uma conta?{' '}
                    <Link
                        href="/login"
                        className={styles.link}
                        prefetch={false}
                    >
                        Entrar
                    </Link>
                </p>
            </section>
        </main>
    );
}
