import {

  Body,

  Controller,

  Get,

  HttpCode,

  Post,

  Query,

  Res,

} from '@nestjs/common';

import type { FastifyReply } from 'fastify';



import { MpgsCheckoutService } from './mpgs-checkout.service';

import { QpayCheckoutService } from './qpay-checkout.service';



/** CSP for the hosted MPGS HTML page (Checkout.js + inline bootstrap). */

const MPGS_CHECKOUT_CSP = [

  "default-src 'self'",

  "script-src 'self' 'unsafe-inline' https://test-cbq.mtf.gateway.mastercard.com https://cbq.gateway.mastercard.com https://test-gateway.mastercard.com https://ap-gateway.mastercard.com https://eu-gateway.mastercard.com https://na-gateway.mastercard.com",

  "frame-src 'self' https://test-cbq.mtf.gateway.mastercard.com https://cbq.gateway.mastercard.com https://test-gateway.mastercard.com https://ap-gateway.mastercard.com https://eu-gateway.mastercard.com https://na-gateway.mastercard.com",

  "connect-src 'self' https://test-cbq.mtf.gateway.mastercard.com https://cbq.gateway.mastercard.com https://test-gateway.mastercard.com https://ap-gateway.mastercard.com https://eu-gateway.mastercard.com https://na-gateway.mastercard.com",

  "style-src 'self' 'unsafe-inline'",

  "img-src 'self' data: https:",

  "form-action 'self' https:",

].join('; ');



@Controller()

export class HostedPaymentsController {

  constructor(

    private readonly qpay: QpayCheckoutService,

    private readonly mpgs: MpgsCheckoutService,

  ) {}



  @Get('qpay/checkout-params')

  @HttpCode(200)

  getQpayCheckoutParams(

    @Query('sid') sid = '',

    @Query('token') token = '',

    @Query('exp') exp = '',

  ) {

    return this.qpay.getCheckoutParams(sid, token, exp);

  }



  /** Bank/NAPS callback — JSON body (Next.js proxy converts form posts). */

  @Post('payments/qpay/callback')

  @HttpCode(200)

  async qpayCallback(@Body() body: Record<string, unknown>) {

    return this.qpay.handleBankCallback(body ?? {});

  }



  @Get('payments/mpgs/checkout')

  async getMpgsCheckout(@Query('sid') sid = '', @Res() res: FastifyReply) {

    const html = await this.mpgs.getCheckoutPage(sid);

    return res

      .status(200)

      .type('text/html; charset=utf-8')

      .header('Content-Security-Policy', MPGS_CHECKOUT_CSP)

      .send(html);

  }



  /** Browser return from Checkout.js — persists session/result before redirect. */

  @Post('payments/mpgs/return')

  @HttpCode(200)

  mpgsReturn(

    @Body()

    body: {

      sid?: string;

      resultIndicator?: string | null;

      status?: 'paid' | 'failed';

    },

  ) {

    return this.mpgs.recordReturn(body ?? {});

  }

}


