-- The message a broker's rate reply arrived on, so a parsed rate can be traced
-- back to the raw email. This FK is hand-written because `messages` lives in the
-- `comms` schema module, which imports `commercial` — declaring the reference in
-- TypeScript would be an import cycle, so `message_id` is a bare ref there and
-- earns its constraint here, exactly as `enquiry_id` does in 0002.
alter table rate_requests
  add constraint rate_requests_message_fk foreign key (message_id) references messages (id);
