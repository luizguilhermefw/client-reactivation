-- Additive message type only. Existing TEXT/IMAGE rows and defaults are unchanged.
ALTER TYPE "OutboundMessageType" ADD VALUE 'TEMPLATE';
