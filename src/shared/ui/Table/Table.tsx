import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cx } from '@/shared/lib';
import styles from './Table.module.css';

type TableProps = ComponentPropsWithoutRef<'table'> & {
  children?: ReactNode;
  className?: string;
};

function TableImpl({ className, children, ...rest }: TableProps) {
  return (
    <table className={cx(styles.table, className)} {...rest}>
      {children}
    </table>
  );
}

type TableWrapProps = ComponentPropsWithoutRef<'div'> & {
  children?: ReactNode;
  className?: string;
};

function TableWrapImpl({ className, children, ...rest }: TableWrapProps) {
  return (
    <div className={cx(styles.wrap, className)} {...rest}>
      {children}
    </div>
  );
}

export const TableWrap = TableWrapImpl;
export const Table = Object.assign(TableImpl, { Wrap: TableWrapImpl });
