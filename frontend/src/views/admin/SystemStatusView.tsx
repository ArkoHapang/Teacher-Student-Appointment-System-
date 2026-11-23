/**
 * System Status View
 *
 * Implements real-time platform health monitoring and infrastructure diagnostics:
 * 1. Liveness probe metrics (uptime, memory utilization, environment).
 * 2. Readiness probe verification (live SQLite database connectivity, ping latency).
 * 3. Schema migration audit (applied vs total available migrations, version alignment).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { SystemHealthData, SystemReadinessData } from '../../types/admin';
import { adminService } from '../../services/adminService';
import { Button } from '../../components/Button/Button';
import { Badge } from '../../components/Badge/Badge';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState, ErrorState } from '../../components/Feedback/Feedback';
import { ActivityIcon, CheckIcon, ClockIcon } from '../../components/Icons/Icons';

export const SystemStatusView: React.FC = () => {
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [readiness, setReadiness] = useState<SystemReadinessData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [healthRes, readinessRes] = await Promise.all([
        adminService.getHealth(),
        adminService.getReadiness()
      ]);
      setHealth(healthRes);
      setReadiness(readinessRes);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to retrieve system status diagnostics.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const formatUptime = (seconds: number): string => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  };

  const isHealthy = health?.status === 'UP' && readiness?.status === 'READY';

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title">System Status</h1>
          <p className="page-header__description">
            Real-time platform diagnostics, database connectivity, and schema migration integrity.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={loadStatus}
          disabled={isLoading}
        >
          Run Diagnostics
        </Button>
      </div>

      {/* Global Error Alert */}
      {errorMessage && (
        <div style={{ marginBottom: '16px' }}>
          <Alert variant="error" onDismiss={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        </div>
      )}

      {isLoading && !health ? (
        <LoadingState message="Querying platform diagnostics and database health..." />
      ) : errorMessage && !health ? (
        <ErrorState
          title="Diagnostics Unavailable"
          message={errorMessage}
          onRetry={loadStatus}
        />
      ) : health && readiness ? (
        <div>
          {/* Top Status Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
              marginBottom: '24px'
            }}
          >
            {/* Overall System Health */}
            <div className="surface-card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  OVERALL SYSTEM STATUS
                </span>
                <Badge variant={isHealthy ? 'active' : 'suspended'}>
                  {isHealthy ? 'HEALTHY & OPERATIONAL' : 'DEGRADED'}
                </Badge>
              </div>
              <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', color: isHealthy ? 'var(--color-success-700)' : 'var(--color-danger-700)', marginBottom: '4px' }}>
                {health.status} / {readiness.status}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                Service: <strong>{health.service}</strong>
              </div>
            </div>

            {/* Database Connectivity */}
            <div className="surface-card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  DATABASE CONNECTIVITY
                </span>
                <Badge variant={readiness.checks.database.connected ? 'active' : 'suspended'}>
                  {readiness.checks.database.connected ? 'CONNECTED' : 'OFFLINE'}
                </Badge>
              </div>
              <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', marginBottom: '4px' }}>
                {readiness.checks.database.latencyMs} ms
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                Round-trip ping response time
              </div>
            </div>

            {/* Schema Migrations */}
            <div className="surface-card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  SCHEMA MIGRATIONS
                </span>
                <Badge variant={readiness.checks.migrations.isUpToDate ? 'active' : 'pending'}>
                  {readiness.checks.migrations.isUpToDate ? 'UP TO DATE' : 'PENDING'}
                </Badge>
              </div>
              <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', marginBottom: '4px' }}>
                {readiness.checks.migrations.appliedCount} / {readiness.checks.migrations.totalAvailable}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                {readiness.checks.migrations.pendingCount === 0
                  ? 'All migrations successfully applied'
                  : `${readiness.checks.migrations.pendingCount} pending migrations`}
              </div>
            </div>

            {/* Uptime & Runtime */}
            <div className="surface-card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  SERVER UPTIME
                </span>
                <Badge variant="info">
                  {health.environment.toUpperCase()}
                </Badge>
              </div>
              <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', marginBottom: '4px' }}>
                {formatUptime(health.uptimeSeconds)}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                Memory: RSS {health.memoryUsage.rssMb}MB | Heap {health.memoryUsage.heapUsedMb}MB
              </div>
            </div>
          </div>

          {/* Diagnostic Panels Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '16px'
            }}
          >
            {/* Database Deep Dive Panel */}
            <div className="surface-card" style={{ padding: '20px' }}>
              <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ActivityIcon size={18} />
                Database Engine Health
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '8px', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Engine Driver</span>
                  <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>node:sqlite (Node 24 native)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '8px', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Storage Target</span>
                  <span className="code-identifier" style={{ fontSize: 'var(--font-size-xs)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {readiness.checks.database.path}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '8px', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Ping Latency</span>
                  <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-success-700)' }}>
                    {readiness.checks.database.latencyMs} milliseconds
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Live Health Verification</span>
                  <Badge variant="active">VERIFIED RESPONDING</Badge>
                </div>
              </div>
            </div>

            {/* Migration Engine Status Panel */}
            <div className="surface-card" style={{ padding: '20px' }}>
              <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckIcon size={18} />
                Migration Alignment & Schema
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '8px', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Total Discovered Migrations</span>
                  <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{readiness.checks.migrations.totalAvailable}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '8px', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Applied Migrations</span>
                  <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-success-700)' }}>
                    {readiness.checks.migrations.appliedCount}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '8px', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Pending Migrations</span>
                  <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
                    {readiness.checks.migrations.pendingCount}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Integrity State</span>
                  <Badge variant={readiness.checks.migrations.isUpToDate ? 'active' : 'suspended'}>
                    {readiness.checks.migrations.isUpToDate ? 'ALL MIGRATIONS IN SYNC' : 'OUT OF SYNC'}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Process Diagnostics Panel */}
            <div className="surface-card" style={{ padding: '20px' }}>
              <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ClockIcon size={18} />
                Process & Memory Footprint
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '8px', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Environment</span>
                  <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{health.environment}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '8px', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Resident Set Size (RSS)</span>
                  <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{health.memoryUsage.rssMb} MB</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '8px', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Heap Memory Used</span>
                  <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{health.memoryUsage.heapUsedMb} MB</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Last Probe Timestamp</span>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    {lastUpdated ? lastUpdated.toLocaleTimeString() : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
