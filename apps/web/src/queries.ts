import type { CreateRequestBody, DecisionBody, ListRequestsQuery } from '@approvals/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: api.me });

export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: api.stats });

export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: api.tags });

export const useRequests = (query: ListRequestsQuery) =>
  useQuery({
    queryKey: ['requests', query],
    queryFn: () => api.listRequests(query),
    // Keep showing the current page while the next one loads, so the list doesn't jump.
    placeholderData: keepPreviousData,
  });

export const useRequest = (id: string) => useQuery({ queryKey: ['request', id], queryFn: () => api.getRequest(id) });

// A change to one request can move it between lists and change the counts, so the request, the lists
// and the stats are refetched.
function useRefreshRequest() {
  const queryClient = useQueryClient();
  return (id: string) => {
    void queryClient.invalidateQueries({ queryKey: ['request', id] });
    void queryClient.invalidateQueries({ queryKey: ['requests'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
    void queryClient.invalidateQueries({ queryKey: ['tags'] });
  };
}

// On success the detail is updated straight from the response. The refresh runs on errors too: a 409
// means someone else acted first, and the panel should show what they did instead of still offering
// Approve and Reject.
export function useDecide(id: string) {
  const queryClient = useQueryClient();
  const refresh = useRefreshRequest();
  return useMutation({
    mutationFn: (body: DecisionBody) => api.decide(id, body),
    onSuccess: (request) => queryClient.setQueryData(['request', id], request),
    onSettled: () => refresh(id),
  });
}

export function useCancel(id: string) {
  const queryClient = useQueryClient();
  const refresh = useRefreshRequest();
  return useMutation({
    mutationFn: () => api.cancel(id),
    onSuccess: (request) => queryClient.setQueryData(['request', id], request),
    onSettled: () => refresh(id),
  });
}

export function useCreateRequest() {
  const queryClient = useQueryClient();
  const refresh = useRefreshRequest();
  return useMutation({
    mutationFn: (body: CreateRequestBody) => api.createRequest(body),
    onSuccess: ({ request }) => {
      queryClient.setQueryData(['request', request.id], request);
      refresh(request.id);
    },
  });
}

export function useAddComment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.addComment(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['request', id] }),
  });
}
