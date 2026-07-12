import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { createProjectSchema, type CreateProjectInput } from '@kinetix/types';

import { Button } from './ui/button';
import { Input } from './ui/input';

export function CreateProjectForm(): React.JSX.Element {
  const [submittedName, setSubmittedName] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: '', slug: '' },
  });

  const onSubmit = (values: CreateProjectInput): void => {
    setSubmittedName(values.name);
    reset();
  };

  return (
    <section className="bg-card text-card-foreground rounded-xl border p-6 shadow-sm">
      <div className="mb-5">
        <p className="text-sm font-medium text-emerald-600">Typed end to end</p>
        <h2 className="mt-1 text-xl font-semibold">Create a project</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          React Hook Form and the shared Zod contract are already wired
          together.
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      >
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="name">
            Name
          </label>
          <Input
            id="name"
            placeholder="Realtime analytics"
            {...register('name')}
          />
          {errors.name ? (
            <p className="text-destructive text-xs">{errors.name.message}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="slug">
            Slug
          </label>
          <Input
            id="slug"
            placeholder="realtime-analytics"
            {...register('slug')}
          />
          {errors.slug ? (
            <p className="text-destructive text-xs">{errors.slug.message}</p>
          ) : null}
        </div>
        <Button className="w-full" disabled={isSubmitting} type="submit">
          Create project
        </Button>
      </form>

      {submittedName ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="size-4" /> {submittedName} passed validation.
        </p>
      ) : null}
    </section>
  );
}
