import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() };
  }

  /** Controlled fault-injection endpoint to verify CloudWatch alarms fire on high error rates */
  @Get('health/simulate-error')
  simulateError() {
    throw new Error('Simulated 500 fault injection for CloudWatch alarm verification');
  }
}
