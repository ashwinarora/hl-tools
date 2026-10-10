-- Reading Hyperliquid's answer: only the documented shapes count, and nothing
-- malformed is ever read as "not a multi-sig".
begin;
\ir _helpers.inc
select no_plan();

create function tests.outcome(p_status int, p_content text) returns text
language sql as $$ select outcome from private.parse_signers(p_status, p_content) $$;

select results_eq(
	$$ select outcome, signers::text[], threshold, http_status from private.parse_signers(200,
		'{"authorizedUsers":["0xB70c120cd3702225fbe3657ace137ed5889f36ee","0x41e84a2c224151b85ef53945d5d31adcfe8955b9"],"threshold":2}') $$,
	$$ values ('policy', array['0x41e84a2c224151b85ef53945d5d31adcfe8955b9','0xb70c120cd3702225fbe3657ace137ed5889f36ee'], 2, 200) $$,
	'a signer list is read, lowercased and sorted');
select is(tests.outcome(200, 'null'), 'none', 'body null is "not a multi-sig"');
select is(tests.outcome(200, ' null '), 'none', 'whitespace around null is tolerated');
select is(tests.outcome(429, ''), 'rate_limited', '429 is a rate limit');
select is(tests.outcome(429, 'null'), 'rate_limited', '429 wins over the body');

select is(tests.outcome(502, '<html>bad gateway</html>'), 'error', 'a gateway error is an error');
select is(tests.outcome(500, 'null'), 'error', 'a 500 with a null body is still an error');
select is(tests.outcome(null, null), 'error', 'no status is an error');
select is(tests.outcome(200, '<html>'), 'error', 'HTML with status 200 is an error');
select is(tests.outcome(200, ''), 'error', 'an empty body is an error, not "none"');
select is(tests.outcome(200, null), 'error', 'a missing body is an error, not "none"');
select is(tests.outcome(200, '"null"'), 'error', 'the string "null" is an error');
select is(tests.outcome(200, '[]'), 'error', 'an array is an error');
select is(tests.outcome(200, '{}'), 'error', 'an empty object is an error');
select is(tests.outcome(200, '{"authorizedUsers":[],"threshold":1}'), 'error', 'no signers is an error');
select is(tests.outcome(200, '{"authorizedUsers":["0x41e84a2c224151b85ef53945d5d31adcfe8955b9"],"threshold":0}'), 'error', 'threshold 0 is an error');
select is(tests.outcome(200, '{"authorizedUsers":["0x41e84a2c224151b85ef53945d5d31adcfe8955b9"],"threshold":2}'), 'error', 'a threshold above the signer count is an error');
select is(tests.outcome(200, '{"authorizedUsers":["0x41e84a2c224151b85ef53945d5d31adcfe8955b9"],"threshold":"1"}'), 'error', 'a string threshold is an error');
select is(tests.outcome(200, '{"authorizedUsers":["0x41e84a2c224151b85ef53945d5d31adcfe8955b9"],"threshold":1.5}'), 'error', 'a fractional threshold is an error');
select is(tests.outcome(200, '{"authorizedUsers":["0x41e8"],"threshold":1}'), 'error', 'a malformed address is an error');
select is(tests.outcome(200, '{"authorizedUsers":[null],"threshold":1}'), 'error', 'a null signer is an error');
select is(tests.outcome(200, '{"authorizedUsers":[42],"threshold":1}'), 'error', 'a numeric signer is an error');
select is(tests.outcome(200, '{"authorizedUsers":["0x41e84a2c224151b85ef53945d5d31adcfe8955b9","0x41E84A2C224151B85EF53945D5D31ADCFE8955B9"],"threshold":1}'), 'error', 'the same signer twice is an error');
select is(tests.outcome(200, '{"authorizedUsers":"0x41e84a2c224151b85ef53945d5d31adcfe8955b9","threshold":1}'), 'error', 'signers that are not a list are an error');
select is(tests.outcome(200,
	(select jsonb_build_object('authorizedUsers', jsonb_agg(tests.addr(n)), 'threshold', 1)::text from generate_series(1, 11) n)),
	'error', 'eleven signers is more than the chain allows');
select is(tests.outcome(200,
	(select jsonb_build_object('authorizedUsers', jsonb_agg(tests.addr(n)), 'threshold', 10)::text from generate_series(1, 10) n)),
	'policy', 'ten of ten is the largest valid set');
select is(tests.outcome(200, '{"authorizedUsers":["0x41e84a2c224151b85ef53945d5d31adcfe8955b9"],"threshold":1,"extra":true}'), 'policy',
	'an extra field does not hide a valid answer');

select * from finish();
rollback;
