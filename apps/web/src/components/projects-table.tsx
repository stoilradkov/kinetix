import { useMemo } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';

import type { ProjectStatus } from '@kinetix/types';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';

interface ProjectSummary {
  name: string;
  owner: string;
  status: ProjectStatus;
}

const projects: ProjectSummary[] = [
  { name: 'Pulse', owner: 'Platform', status: 'active' },
  { name: 'Relay', owner: 'Growth', status: 'active' },
  { name: 'Atlas', owner: 'Data', status: 'paused' },
];

const columnHelper = createColumnHelper<ProjectSummary>();

export function ProjectsTable(): React.JSX.Element {
  const columns = useMemo(
    () => [
      columnHelper.accessor('name', { header: 'Project' }),
      columnHelper.accessor('owner', { header: 'Owner' }),
      columnHelper.accessor('status', {
        header: 'Status',
        cell: ({ getValue }) => (
          <span className="inline-flex items-center gap-1.5 capitalize">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {getValue()}
          </span>
        ),
      }),
    ],
    [],
  );
  const table = useReactTable({
    data: projects,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="bg-card rounded-xl border p-4 shadow-sm">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
