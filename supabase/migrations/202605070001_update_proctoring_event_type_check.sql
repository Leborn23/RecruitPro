alter table public.interview_proctoring_events
  drop constraint if exists interview_proctoring_events_event_type_check;

alter table public.interview_proctoring_events
  add constraint interview_proctoring_events_event_type_check
  check (
    event_type in (
      'camera_check_passed',
      'camera_denied',
      'camera_closed',
      'no_face',
      'multiple_faces',
      'off_screen_attention',
      'head_turned_left',
      'head_turned_right',
      'head_down',
      'head_up',
      'face_occluded',
      'page_hidden',
      'window_blur'
    )
  );
