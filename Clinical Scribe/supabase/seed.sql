-- Local development only: the database wakes the worker through the local gateway.
select public.svc_set_functions_url('http://kong:8000/functions/v1');
