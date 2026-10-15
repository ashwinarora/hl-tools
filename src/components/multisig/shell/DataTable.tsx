import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { cn } from "#/lib/utils";

export interface DataColumn<T> {
	readonly id: string;
	readonly header: string;
	/** Right-aligned figures in tabular digits. */
	readonly numeric?: boolean;
	/** Ascending order of two rows. Left out, the column cannot be sorted. */
	readonly sort?: (a: T, b: T) => number;
	/** The first click puts the largest or newest first. Defaults to `numeric`. */
	readonly descFirst?: boolean;
	readonly cell: (row: T) => ReactNode;
	/** Extra classes for one cell: a tone, wrapping. */
	readonly cellClass?: (row: T) => string | undefined;
	/** Something small shown after the header text (a help hint). */
	readonly headerExtra?: ReactNode;
}

/**
 * A read-only table whose every sortable column sorts by a click on its
 * header. Wide tables scroll sideways inside their own box, so the page
 * itself never does. Rows keep their identity across live updates.
 */
export function DataTable<T>({
	label,
	columns,
	rows,
	rowKey,
	initialSort,
	empty,
	className,
}: {
	/** What the table lists, for screen readers. */
	label: string;
	columns: readonly DataColumn<T>[];
	rows: readonly T[];
	rowKey: (row: T) => string;
	initialSort?: { readonly id: string; readonly desc: boolean };
	/** Shown in place of rows when there are none. */
	empty: ReactNode;
	className?: string;
}) {
	const [sorting, setSorting] = useState<SortingState>(
		initialSort ? [{ id: initialSort.id, desc: initialSort.desc }] : [],
	);
	const defs = useMemo<ColumnDef<T>[]>(
		() =>
			columns.map((c) => {
				const sort = c.sort;
				return {
					id: c.id,
					header: c.header,
					accessorFn: (row: T) => row,
					enableSorting: !!sort,
					sortDescFirst: c.descFirst ?? c.numeric ?? false,
					sortingFn: sort ? (a, b) => sort(a.original, b.original) : "auto",
					cell: (ctx) => c.cell(ctx.row.original),
					meta: c,
				};
			}),
		[columns],
	);
	const data = useMemo(() => [...rows], [rows]);
	const table = useReactTable({
		data,
		columns: defs,
		state: { sorting },
		onSortingChange: setSorting,
		getRowId: rowKey,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		enableSortingRemoval: false,
		enableMultiSort: false,
	});
	const body = table.getRowModel().rows;
	return (
		<section
			aria-label={label}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls sideways must be reachable by keyboard
			tabIndex={0}
			className={cn(
				"overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
				className,
			)}
		>
			<table className="w-full border-collapse text-[13px]">
				<thead>
					<tr className="border-b border-border">
						{table.getFlatHeaders().map((h) => {
							const c = h.column.columnDef.meta as DataColumn<T>;
							const dir = h.column.getIsSorted();
							const sortable = h.column.getCanSort();
							return (
								<th
									key={h.id}
									scope="col"
									aria-sort={
										!sortable
											? undefined
											: dir === "asc"
												? "ascending"
												: dir === "desc"
													? "descending"
													: "none"
									}
									className={cn(
										"whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground first:pl-4 last:pr-4",
										c.numeric ? "text-right" : "text-left",
									)}
								>
									<span
										className={cn(
											"inline-flex items-center gap-1",
											c.numeric && "flex-row-reverse",
										)}
									>
										{sortable ? (
											<button
												type="button"
												onClick={h.column.getToggleSortingHandler()}
												title={`Sort by ${c.header.toLowerCase()}`}
												className={cn(
													"-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground",
													c.numeric && "flex-row-reverse",
													dir && "text-foreground",
												)}
											>
												{c.header}
												{dir === "asc" ? (
													<ArrowUp className="size-3" aria-hidden />
												) : dir === "desc" ? (
													<ArrowDown className="size-3" aria-hidden />
												) : (
													<ChevronsUpDown
														className="size-3 opacity-50"
														aria-hidden
													/>
												)}
											</button>
										) : (
											c.header
										)}
										{c.headerExtra}
									</span>
								</th>
							);
						})}
					</tr>
				</thead>
				<tbody>
					{body.length === 0 ? (
						<tr>
							<td
								colSpan={columns.length}
								className="px-4 py-6 text-center text-sm text-muted-foreground"
							>
								{empty}
							</td>
						</tr>
					) : (
						body.map((row) => (
							<tr
								key={row.id}
								className="border-t border-border first:border-t-0"
							>
								{row.getVisibleCells().map((cell) => {
									const c = cell.column.columnDef.meta as DataColumn<T>;
									return (
										<td
											key={cell.id}
											className={cn(
												"whitespace-nowrap px-3 py-2 align-top first:pl-4 last:pr-4",
												c.numeric && "text-right font-mono tabular-nums",
												c.cellClass?.(row.original),
											)}
										>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</td>
									);
								})}
							</tr>
						))
					)}
				</tbody>
			</table>
		</section>
	);
}
